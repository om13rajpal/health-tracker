import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { SleepSession } from "../../models/SleepSession.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await SleepSession.deleteMany({});
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

describe("POST /api/sleep", () => {
  it("rejects an unauthenticated request", async () => {
    const app = createApp();
    const res = await request(app).post("/api/sleep").send({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "2026-09-07T04:00:00.000Z",
    });
    expect(res.status).toBe(401);
  });

  it("logs a sleep session and computes its midpoint", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    const res = await agent.post("/api/sleep").send({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "2026-09-07T04:00:00.000Z",
    });

    expect(res.status).toBe(201);
    const stored = await SleepSession.findOne({ date: "2026-09-06" });
    expect(stored?.midpoint.toISOString()).toBe("2026-09-07T00:15:00.000Z");
  });

  it("overwrites the previous session when logging for the same date", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    // First POST for 2026-09-06
    await agent.post("/api/sleep").send({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "2026-09-07T04:00:00.000Z",
    });

    // Second POST for the same date with different times
    await agent.post("/api/sleep").send({
      date: "2026-09-06",
      bedTime: "2026-09-06T22:00:00.000Z",
      wakeTime: "2026-09-07T06:00:00.000Z",
    });

    // Should have exactly one document with the second call's values
    const sessions = await SleepSession.find({ date: "2026-09-06" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].bedTime.toISOString()).toBe("2026-09-06T22:00:00.000Z");
    expect(sessions[0].wakeTime.toISOString()).toBe("2026-09-07T06:00:00.000Z");
    // Midpoint should be 2026-09-07T02:00:00.000Z (average of 22:00 and 06:00)
    expect(sessions[0].midpoint.toISOString()).toBe("2026-09-07T02:00:00.000Z");
  });
});

describe("GET /api/sleep", () => {
  it("lists sessions in a date range", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    await SleepSession.create([
      { date: "2026-09-01", bedTime: new Date("2026-09-01T20:00:00Z"), wakeTime: new Date("2026-09-02T04:00:00Z"), midpoint: new Date("2026-09-02T00:00:00Z") },
      { date: "2026-09-10", bedTime: new Date("2026-09-10T20:00:00Z"), wakeTime: new Date("2026-09-11T04:00:00Z"), midpoint: new Date("2026-09-11T00:00:00Z") },
    ]);
    const res = await agent.get("/api/sleep?from=2026-09-05&to=2026-09-15");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("includes today's IST session when the default window is computed before 05:30 IST", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    // 20:00Z is 01:30 IST the next day — the window where a UTC-derived upper
    // bound would be yesterday and would exclude today's rows entirely.
    await SleepSession.create({
      date: "2026-09-07",
      bedTime: new Date("2026-09-06T18:00:00Z"),
      wakeTime: new Date("2026-09-07T02:00:00Z"),
      midpoint: new Date("2026-09-06T22:00:00Z"),
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-06T20:00:00.000Z"));
    try {
      const res = await agent.get("/api/sleep");
      expect(res.status).toBe(200);
      expect(res.body.map((s: { date: string }) => s.date)).toContain("2026-09-07");
    } finally {
      vi.useRealTimers();
    }
  });
});
