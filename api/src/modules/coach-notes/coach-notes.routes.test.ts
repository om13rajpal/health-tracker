import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { CoachNote } from "../../models/CoachNote.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await CoachNote.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/coach-notes", () => {
  it("lists notes most-recent-first, default limit 10", async () => {
    await CoachNote.create({ weekOf: "2026-08-25", digest: {}, summary: "older", suggestions: [], source: "mcp_session" });
    await CoachNote.create({ weekOf: "2026-09-01", digest: {}, summary: "newer", suggestions: [], source: "mcp_session" });
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });
    const res = await agent.get("/api/coach-notes");
    expect(res.status).toBe(200);
    expect(res.body[0].summary).toBe("newer");
  });

  it("falls back to the default limit for an invalid limit query param", async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        CoachNote.create({
          weekOf: `2026-0${(i % 9) + 1}-01`,
          digest: {},
          summary: `note-${i}`,
          suggestions: [],
          source: "mcp_session",
        }),
      ),
    );
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });

    const zeroRes = await agent.get("/api/coach-notes?limit=0");
    expect(zeroRes.status).toBe(200);
    expect(zeroRes.body.length).toBe(10);

    const nanRes = await agent.get("/api/coach-notes?limit=abc");
    expect(nanRes.status).toBe(200);
    expect(nanRes.body.length).toBe(10);
  });
});
