import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { HealthSample } from "./HealthSample.js";
import { SleepSession } from "./SleepSession.js";
import { Exercise } from "./Exercise.js";
import { WorkoutSession } from "./WorkoutSession.js";
import { ProgressionState } from "./ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("HealthSample", () => {
  it("stores a heart-rate sample with its metric as metadata", async () => {
    const doc = await HealthSample.create({
      timestamp: new Date("2026-09-06T08:00:00.000Z"),
      metric: "heart_rate",
      value: 62,
      unit: "bpm",
      source: "ios-bridge",
    });
    expect(doc.metric).toBe("heart_rate");
    expect(doc.value).toBe(62);
  });
});

describe("SleepSession", () => {
  it("computes nothing on its own but stores bed/wake times and a midpoint", async () => {
    const bedTime = new Date("2026-09-06T20:30:00.000Z");
    const wakeTime = new Date("2026-09-07T04:00:00.000Z");
    const midpoint = new Date((bedTime.getTime() + wakeTime.getTime()) / 2);
    const doc = await SleepSession.create({ date: "2026-09-06", bedTime, wakeTime, midpoint });
    expect(doc.date).toBe("2026-09-06");
    expect(doc.midpoint.toISOString()).toBe(midpoint.toISOString());
  });
});

describe("Exercise", () => {
  it("stores a seeded exercise with muscle groups and equipment", async () => {
    const doc = await Exercise.create({
      slug: "incline-pushup",
      name: "Incline Push-Up",
      muscleGroups: ["chest", "triceps"],
      equipment: ["none"],
      images: [],
    });
    expect(doc.slug).toBe("incline-pushup");
  });
});

describe("WorkoutSession", () => {
  it("stores embedded exercises and sets", async () => {
    const doc = await WorkoutSession.create({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [{ reps: 12, weight: 0, type: "normal" }],
        },
      ],
    });
    expect(doc.exercises).toHaveLength(1);
    expect(doc.exercises[0].sets[0].reps).toBe(12);
  });
});

describe("ProgressionState", () => {
  it("stores one bodyweight-phase state per exercise", async () => {
    const doc = await ProgressionState.create({
      exerciseId: "incline-pushup",
      phase: "bodyweight",
      level: 0,
      repRangeLow: 8,
      repRangeHigh: 15,
      consecutiveTopOfRange: 0,
      consecutiveBelowRange: 0,
    });
    expect(doc.phase).toBe("bodyweight");
  });
});
