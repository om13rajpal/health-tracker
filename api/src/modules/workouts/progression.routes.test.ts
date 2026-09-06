import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { ProgressionState } from "../../models/ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
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

describe("GET /api/progression", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(createApp()).get("/api/progression");
    expect(res.status).toBe(401);
  });

  it("lists all progression states", async () => {
    await ProgressionState.create({
      exerciseId: "incline-pushup",
      phase: "bodyweight",
      level: 1,
      repRangeLow: 8,
      repRangeHigh: 15,
      consecutiveTopOfRange: 0,
      consecutiveBelowRange: 0,
      consecutiveMisses: 0,
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/progression");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].level).toBe(1);
  });
});
