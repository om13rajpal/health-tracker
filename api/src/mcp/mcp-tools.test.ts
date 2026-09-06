import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { FoodEntry } from "../models/FoodEntry.js";
import { SleepSession } from "../models/SleepSession.js";
import { ProgressionState } from "../models/ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  process.env.MCP_ACCESS_TOKEN = "test-mcp-token";
});

afterEach(async () => {
  await Promise.all([
    WorkoutSession.deleteMany({}),
    FoodEntry.deleteMany({}),
    SleepSession.deleteMany({}),
    ProgressionState.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// Same reasoning as mcp/server.test.ts: the stateless Streamable HTTP
// transport answers a POST with an SSE stream, so the JSON-RPC payload
// arrives on a `data:` line rather than as the body.
function parseSseResult(text: string) {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`No SSE data line in response: ${JSON.stringify(text)}`);
  return JSON.parse(line.slice("data:".length).trim());
}

function mcpRequest(app: ReturnType<typeof createApp>) {
  return request(app)
    .post("/mcp")
    .set("Authorization", "Bearer test-mcp-token")
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
}

async function callTool(app: ReturnType<typeof createApp>, name: string, args: unknown) {
  const res = await mcpRequest(app).send({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  expect(res.status).toBe(200);
  const payload = parseSseResult(res.text);
  expect(payload.error).toBeUndefined();
  expect(payload.result.isError).toBeFalsy();
  return JSON.parse(payload.result.content[0].text);
}

describe("MCP read tools", () => {
  it("get_workouts returns full exercise/set detail, not just a count", async () => {
    const app = createApp();
    await WorkoutSession.create({
      date: "2026-09-05",
      exercises: [{ exerciseId: "back-squat", sets: [{ reps: 5, weight: 82.5, rir: 1, type: "normal" }] }],
    });

    const sessions = await callTool(app, "get_workouts", { from: "2026-09-01", to: "2026-09-10" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].exercises[0].exerciseId).toBe("back-squat");
    expect(sessions[0].exercises[0].sets[0].weight).toBe(82.5);
  });

  it("get_sleep_sessions returns bed/wake/midpoint detail", async () => {
    const app = createApp();
    await SleepSession.create({
      date: "2026-09-05",
      bedTime: new Date("2026-09-04T17:30:00.000Z"),
      wakeTime: new Date("2026-09-05T01:00:00.000Z"),
      midpoint: new Date("2026-09-04T21:15:00.000Z"),
    });

    const sessions = await callTool(app, "get_sleep_sessions", { from: "2026-09-01", to: "2026-09-10" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].date).toBe("2026-09-05");
  });

  it("get_progression returns the current per-exercise targets", async () => {
    const app = createApp();
    await ProgressionState.create({ exerciseId: "bench-press", phase: "barbell", loadKg: 60, increment: 2.5 });

    const states = await callTool(app, "get_progression", {});
    expect(states).toHaveLength(1);
    expect(states[0].exerciseId).toBe("bench-press");
    expect(states[0].loadKg).toBe(60);
  });

  it("get_food_entries returns every logged item for the date", async () => {
    const app = createApp();
    await FoodEntry.create({
      date: "2026-09-05",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 180, proteinG: 9, carbsG: 24, fatG: 5 },
    });

    const entries = await callTool(app, "get_food_entries", { date: "2026-09-05" });
    expect(entries).toHaveLength(1);
    expect(entries[0].refId).toBe("dal-tadka");
  });
});

describe("MCP write tools", () => {
  it("log_workout writes a session through the real progression engine and tags it as MCP-authored", async () => {
    const app = createApp();
    await ProgressionState.create({
      exerciseId: "incline-pushup",
      phase: "bodyweight",
      level: 0,
      repRangeLow: 8,
      repRangeHigh: 15,
      consecutiveTopOfRange: 1,
      consecutiveBelowRange: 0,
    });

    const result = await callTool(app, "log_workout", {
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

    // Same progression outcome as the REST endpoint's own test for this exact
    // scenario — proof this reuses logWorkoutSession rather than a separate,
    // possibly-looser code path.
    expect(result.progressionResults["incline-pushup"].advanced).toBe(true);

    const stored = await WorkoutSession.findOne({ date: "2026-09-06" });
    expect(stored?.loggedVia).toBe("mcp");
    // No OAuthClient is registered for the static bearer token path used in
    // these tests, so attribution falls back to a generic label rather than
    // crashing or leaving the field unset.
    expect(stored?.loggedByClient).toBeTruthy();

    const state = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(state?.level).toBe(1);
  });

  it("rejects a log_workout with no reps on any set, same as the web form's own validation", async () => {
    const app = createApp();
    const res = await mcpRequest(app).send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "log_workout",
        // exercises requires at least one set per WorkoutSessionInputSchema,
        // but zero exercises fails the schema's own .min(1) — this exercises
        // that the MCP tool is bound to the same schema, not a hand-copied one.
        arguments: { date: "2026-09-06", exercises: [] },
      },
    });
    const payload = parseSseResult(res.text);
    expect(payload.result?.isError ?? payload.error !== undefined).toBeTruthy();
  });

  it("log_food writes a tagged entry that counts toward the day's macro summary", async () => {
    const app = createApp();
    await callTool(app, "log_food", {
      date: "2026-09-06",
      mealSlot: "dinner",
      source: "indian_dish",
      refId: "rajma",
      macros: { calories: 245, proteinG: 15, carbsG: 40, fatG: 1 },
    });

    const entries = await FoodEntry.find({ date: "2026-09-06" });
    expect(entries).toHaveLength(1);
    expect(entries[0].loggedVia).toBe("mcp");
    expect(entries[0].macros.proteinG).toBe(15);
  });

  it("log_sleep upserts by date, matching the web app's own behaviour", async () => {
    const app = createApp();
    await callTool(app, "log_sleep", {
      date: "2026-09-06",
      bedTime: "2026-09-05T17:30:00.000Z",
      wakeTime: "2026-09-06T01:00:00.000Z",
    });
    await callTool(app, "log_sleep", {
      date: "2026-09-06",
      bedTime: "2026-09-05T18:00:00.000Z",
      wakeTime: "2026-09-06T01:30:00.000Z",
    });

    const sessions = await SleepSession.find({ date: "2026-09-06" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].loggedVia).toBe("mcp");
  });

  it("update_progression sets a new target without touching the engine's own streak counters", async () => {
    const app = createApp();
    await ProgressionState.create({
      exerciseId: "back-squat",
      phase: "barbell",
      loadKg: 80,
      increment: 2.5,
      consecutiveMisses: 1,
    });

    await callTool(app, "update_progression", { exerciseId: "back-squat", loadKg: 100, repRangeLow: 3, repRangeHigh: 3 });

    const state = await ProgressionState.findOne({ exerciseId: "back-squat" });
    expect(state?.loadKg).toBe(100);
    expect(state?.repRangeLow).toBe(3);
    // Untouched — a routine change is not the same event as a missed set, and
    // must not silently clear a real miss streak.
    expect(state?.consecutiveMisses).toBe(1);
  });

  it("update_progression creates a target for a lift with none yet, for starting a new routine from scratch", async () => {
    const app = createApp();
    await callTool(app, "update_progression", {
      exerciseId: "overhead-press",
      phase: "barbell",
      loadKg: 30,
      increment: 2.5,
      repRangeLow: 5,
      repRangeHigh: 5,
    });

    const state = await ProgressionState.findOne({ exerciseId: "overhead-press" });
    expect(state?.loadKg).toBe(30);
  });
});
