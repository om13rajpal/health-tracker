import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { DailyRollup } from "../../models/DailyRollup.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await DailyRollup.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/rollups", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(createApp()).get("/api/rollups");
    expect(res.status).toBe(401);
  });

  it("lists rollups in a date range", async () => {
    await DailyRollup.create([
      { date: "2026-09-01", totalSteps: 3000, proteinG: 100, hardSets: 2 },
      { date: "2026-09-10", totalSteps: 8000, proteinG: 150, hardSets: 5 },
    ]);
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });
    const res = await agent.get("/api/rollups?from=2026-09-05&to=2026-09-15");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalSteps).toBe(8000);
  });

  it("includes today's IST rollup when the default window is computed before 05:30 IST", async () => {
    // 20:00Z is 01:30 IST the next day — a UTC-derived upper bound would be
    // yesterday and would drop today's rows.
    await DailyRollup.create({ date: "2026-09-07", totalSteps: 1200, proteinG: 90, hardSets: 3 });
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-06T20:00:00.000Z"));
    try {
      const res = await agent.get("/api/rollups");
      expect(res.status).toBe(200);
      expect(res.body.map((r: { date: string }) => r.date)).toContain("2026-09-07");
    } finally {
      vi.useRealTimers();
    }
  });
});
