import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { HealthSample } from "../../models/HealthSample.js";
import { HealthWorkout } from "../../models/HealthWorkout.js";
import { HealthCategorySample } from "../../models/HealthCategorySample.js";
import { Mood } from "../../models/Mood.js";
import { PendingWrite } from "../../models/PendingWrite.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  process.env.MCP_ACCESS_TOKEN = "test-ingestion-token";
});

afterEach(async () => {
  await HealthSample.deleteMany({});
  await HealthWorkout.deleteMany({});
  await HealthCategorySample.deleteMany({});
  await Mood.deleteMany({});
  await PendingWrite.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /api/health-events", () => {
  it("rejects a request without a bearer token", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/health-events")
      .send({
        source: "ios-bridge",
        metric: "steps",
        timestamp: "2026-09-06T08:00:00.000Z",
        value: 4000,
      });
    expect(res.status).toBe(401);
  });

  it("stores a valid event and returns 201", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/health-events")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        metric: "steps",
        timestamp: "2026-09-06T08:00:00.000Z",
        value: 4000,
      });
    expect(res.status).toBe(201);

    // The queryable view — not just the backing bucket collection — must exist.
    // A write that races Model.init() creates the bucket but no view, and every
    // later find() returns [] forever after.
    const collectionNames = (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name);
    expect(collectionNames).toContain("healthsamples");

    const stored = await HealthSample.find({});
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBe(4000);
  });

  it("rejects a malformed payload with 400", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/health-events")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({ source: "ios-bridge", metric: "not-real", timestamp: "bad-date" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/health-events/workouts", () => {
  it("rejects a request without a bearer token", async () => {
    const res = await request(createApp())
      .post("/api/health-events/workouts")
      .send({
        source: "ios-bridge",
        activityType: "running",
        startDate: "2026-09-06T08:00:00.000Z",
        endDate: "2026-09-06T08:30:00.000Z",
        durationSeconds: 1800,
      });
    expect(res.status).toBe(401);
  });

  it("stores a valid workout and returns 201", async () => {
    const res = await request(createApp())
      .post("/api/health-events/workouts")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        activityType: "running",
        startDate: "2026-09-06T08:00:00.000Z",
        endDate: "2026-09-06T08:30:00.000Z",
        durationSeconds: 1800,
        totalEnergyBurnedKcal: 320,
        totalDistanceMeters: 5000,
      });
    expect(res.status).toBe(201);

    const stored = await HealthWorkout.find({});
    expect(stored).toHaveLength(1);
    expect(stored[0].activityType).toBe("running");
    expect(stored[0].durationSeconds).toBe(1800);
    expect(stored[0].totalDistanceMeters).toBe(5000);
  });

  it("stores a workout with no energy/distance (e.g. a strength workout HealthKit has no distance for)", async () => {
    const res = await request(createApp())
      .post("/api/health-events/workouts")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        activityType: "functional_strength_training",
        startDate: "2026-09-06T08:00:00.000Z",
        endDate: "2026-09-06T08:45:00.000Z",
        durationSeconds: 2700,
      });
    expect(res.status).toBe(201);

    const stored = await HealthWorkout.findOne({});
    expect(stored?.totalEnergyBurnedKcal).toBeUndefined();
    expect(stored?.totalDistanceMeters).toBeUndefined();
  });

  it("rejects a malformed payload with 400", async () => {
    const res = await request(createApp())
      .post("/api/health-events/workouts")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({ source: "ios-bridge", activityType: "running" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/health-events/category-samples", () => {
  it("rejects a request without a bearer token", async () => {
    const res = await request(createApp())
      .post("/api/health-events/category-samples")
      .send({
        source: "ios-bridge",
        category: "sleep_analysis",
        value: "asleep_deep",
        startDate: "2026-09-06T20:00:00.000Z",
        endDate: "2026-09-06T21:00:00.000Z",
      });
    expect(res.status).toBe(401);
  });

  it("stores a valid sleep-analysis sample and returns 201", async () => {
    const res = await request(createApp())
      .post("/api/health-events/category-samples")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        category: "sleep_analysis",
        value: "asleep_deep",
        startDate: "2026-09-06T20:00:00.000Z",
        endDate: "2026-09-06T21:00:00.000Z",
      });
    expect(res.status).toBe(201);

    const stored = await HealthCategorySample.findOne({});
    expect(stored?.category).toBe("sleep_analysis");
    expect(stored?.value).toBe("asleep_deep");
  });

  it("rejects an unknown category with 400", async () => {
    const res = await request(createApp())
      .post("/api/health-events/category-samples")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        category: "not_a_real_category",
        value: "x",
        startDate: "2026-09-06T20:00:00.000Z",
        endDate: "2026-09-06T21:00:00.000Z",
      });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/health-events/mood", () => {
  it("rejects a request without a bearer token", async () => {
    const res = await request(createApp())
      .post("/api/health-events/mood")
      .send({
        source: "ios-bridge",
        kind: "momentary_emotion",
        valence: 0.6,
        labels: ["happy"],
        associations: ["family"],
        date: "2026-09-06T20:00:00.000Z",
      });
    expect(res.status).toBe(401);
  });

  it("stores a valid mood entry and returns 201", async () => {
    const res = await request(createApp())
      .post("/api/health-events/mood")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        kind: "momentary_emotion",
        valence: 0.6,
        valenceClassification: "slightly_pleasant",
        labels: ["happy", "content"],
        associations: ["family"],
        date: "2026-09-06T20:00:00.000Z",
      });
    expect(res.status).toBe(201);

    const stored = await Mood.findOne({});
    expect(stored?.kind).toBe("momentary_emotion");
    expect(stored?.valence).toBe(0.6);
    expect(stored?.labels).toEqual(["happy", "content"]);
  });

  it("rejects a valence outside -1..1 with 400", async () => {
    const res = await request(createApp())
      .post("/api/health-events/mood")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        kind: "momentary_emotion",
        valence: 2.5,
        labels: [],
        associations: [],
        date: "2026-09-06T20:00:00.000Z",
      });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/health-events/pending-writes", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await request(createApp()).get("/api/health-events/pending-writes");
    expect(res.status).toBe(401);
  });

  it("returns only undelivered pending writes, oldest first", async () => {
    const undelivered = await PendingWrite.create({
      metric: "steps",
      value: 1200,
      timestamp: new Date("2026-09-01T10:00:00Z"),
      delivered: false,
    });
    await PendingWrite.create({
      metric: "weight",
      value: 70.2,
      unit: "kg",
      timestamp: new Date("2026-09-01T09:00:00Z"),
      delivered: true,
      deliveredAt: new Date(),
    });

    const res = await request(createApp())
      .get("/api/health-events/pending-writes")
      .set("Authorization", "Bearer test-ingestion-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: undelivered._id.toString(),
        metric: "steps",
        value: 1200,
        timestamp: "2026-09-01T10:00:00.000Z",
      },
    ]);
  });
});

describe("POST /api/health-events/pending-writes/:id/ack", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await request(createApp()).post(
      "/api/health-events/pending-writes/000000000000000000000000/ack"
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(createApp())
      .post("/api/health-events/pending-writes/000000000000000000000000/ack")
      .set("Authorization", "Bearer test-ingestion-token");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const res = await request(createApp())
      .post("/api/health-events/pending-writes/not-a-valid-id/ack")
      .set("Authorization", "Bearer test-ingestion-token");
    expect(res.status).toBe(400);
  });

  it("marks a pending write delivered", async () => {
    const doc = await PendingWrite.create({
      metric: "heart_rate",
      value: 62,
      unit: "count/min",
      timestamp: new Date("2026-09-01T10:00:00Z"),
      delivered: false,
    });

    const res = await request(createApp())
      .post(`/api/health-events/pending-writes/${doc._id.toString()}/ack`)
      .set("Authorization", "Bearer test-ingestion-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acked: true });

    const updated = await PendingWrite.findById(doc._id);
    expect(updated?.delivered).toBe(true);
    expect(updated?.deliveredAt).toBeInstanceOf(Date);
  });
});
