import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { WorkoutSession } from "../../models/WorkoutSession.js";
import { ProgressionState } from "../../models/ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

beforeEach(async () => {
  await ProgressionState.create({
    exerciseId: "incline-pushup",
    phase: "bodyweight",
    level: 0,
    repRangeLow: 8,
    repRangeHigh: 15,
    consecutiveTopOfRange: 1,
    consecutiveBelowRange: 0,
  });
});

afterEach(async () => {
  await WorkoutSession.deleteMany({});
  await ProgressionState.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function loggedInAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "test-password" });
  return agent;
}

describe("POST /api/workouts", () => {
  it("rejects an unauthenticated request", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/workouts")
      .send({ date: "2026-09-06", exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 15, weight: 0, type: "normal" }] }] });
    expect(res.status).toBe(401);
  });

  it("logs a session and advances progression when the top of the range is hit twice", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    const res = await agent.post("/api/workouts").send({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 15, weight: 0, rir: 2, type: "normal" },
            { reps: 15, weight: 0, rir: 2, type: "normal" },
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.progressionResults["incline-pushup"].advanced).toBe(true);

    const stored = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(stored?.level).toBe(1);

    const sessions = await WorkoutSession.find({});
    expect(sessions).toHaveLength(1);
  });

  it("uses the hardest (lowest-RIR) set to judge effort, not just the first set logged", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    // First set is a real (non-warm-up) set logged at an easy RIR 8; the two
    // sets after it are genuinely hard (RIR 1). Warm-up sets are filtered out
    // before this comparison (see the "excludes warm-up sets" test above), so
    // this set must be type "normal" to keep testing what it claims: if the
    // service naively read only sets[0].rir, it would see RIR 8, judge the
    // whole exercise as low-effort, and wrongly refuse to count this toward
    // advancing — even though the top of the rep range was hit under real
    // difficulty on the sets that mattered.
    const res = await agent.post("/api/workouts").send({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 15, weight: 0, rir: 8, type: "normal" },
            { reps: 15, weight: 0, rir: 1, type: "normal" },
            { reps: 15, weight: 0, rir: 1, type: "normal" },
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.progressionResults["incline-pushup"].advanced).toBe(true);
  });

  it("excludes warm-up sets from the rep-range check so they cannot block advancement", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    // The warm-up is 5 reps, far below the 15-rep top of the range. Both real
    // working sets hit 15 at RIR 1. If warm-ups were counted, the "every set
    // hit the top" check would fail on the 5 and advancement would be blocked
    // permanently, no matter how well the working sets went.
    const res = await agent.post("/api/workouts").send({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 5, weight: 0, rir: 9, type: "warmup" },
            { reps: 15, weight: 0, rir: 1, type: "normal" },
            { reps: 15, weight: 0, rir: 1, type: "normal" },
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.progressionResults["incline-pushup"].advanced).toBe(true);

    // The warm-up is still persisted on the session — it is excluded from
    // progression, not discarded.
    const sessions = await WorkoutSession.find({});
    expect(sessions[0].exercises[0].sets).toHaveLength(3);
  });

  it("does not count a session with no logged RIR as hard effort", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    // Both sets hit the top of the range, and the seeded state is one hit away
    // from advancing — but neither set has an RIR. Missing data is not
    // confirmed maximal effort, so this must not advance.
    const res = await agent.post("/api/workouts").send({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 15, weight: 0, type: "normal" },
            { reps: 15, weight: 0, type: "normal" },
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.progressionResults["incline-pushup"].advanced).toBe(false);

    const stored = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(stored?.level).toBe(0);
  });

  it("judges barbell sets against the program's prescribed reps, not the first set logged", async () => {
    await ProgressionState.create({
      exerciseId: "back-squat",
      phase: "barbell",
      loadKg: 40,
      increment: 5,
      repRangeLow: 5,
      repRangeHigh: 5,
      consecutiveMisses: 0,
    });

    const app = createApp();
    const agent = await loggedInAgent(app);

    // The first set is 8 reps and is NOT flagged as a warm-up, so it survives
    // the warm-up filter. The program prescribes 5. Reading the target off
    // sets[0] would make it 8, and the two genuine 5-rep working sets would
    // wrongly count as missed reps (5 >= 8 is false), blocking the load bump.
    const res = await agent.post("/api/workouts").send({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "back-squat",
          sets: [
            { reps: 8, weight: 40, rir: 3, type: "normal" },
            { reps: 5, weight: 40, rir: 2, type: "normal" },
            { reps: 5, weight: 40, rir: 2, type: "normal" },
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.progressionResults["back-squat"].loadIncreased).toBe(true);

    const stored = await ProgressionState.findOne({ exerciseId: "back-squat" });
    expect(stored?.loadKg).toBe(45);
  });
});

describe("GET /api/workouts", () => {
  it("lists sessions in a date range", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    await WorkoutSession.create([
      { date: "2026-09-01", exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 10, weight: 0, type: "normal" }] }] },
      { date: "2026-09-10", exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 10, weight: 0, type: "normal" }] }] },
    ]);
    const res = await agent.get("/api/workouts?from=2026-09-05&to=2026-09-15");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBe("2026-09-10");
  });

  it("defaults to the last 30 days when no range is given", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/workouts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("includes today's IST session when the default window is computed before 05:30 IST", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    // 20:00Z is 01:30 IST the next day — a UTC-derived upper bound would be
    // yesterday and would drop today's rows.
    await WorkoutSession.create({
      date: "2026-09-07",
      exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 10, weight: 0, type: "normal" }] }],
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-06T20:00:00.000Z"));
    try {
      const res = await agent.get("/api/workouts");
      expect(res.status).toBe(200);
      expect(res.body.map((s: { date: string }) => s.date)).toContain("2026-09-07");
    } finally {
      vi.useRealTimers();
    }
  });
});
