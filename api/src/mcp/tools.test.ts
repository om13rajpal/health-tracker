import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { SleepSession } from "../models/SleepSession.js";
import { getWeeklyDigest } from "./tools.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([FoodEntry.deleteMany({}), WorkoutSession.deleteMany({}), SleepSession.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("getWeeklyDigest", () => {
  it("summarizes workouts, nutrition, and sleep for the given week", async () => {
    await FoodEntry.create({
      date: "2026-09-02",
      mealSlot: "lunch",
      source: "indian_dish",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
    });
    await WorkoutSession.create({
      date: "2026-09-02",
      exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 12, weight: 0, rir: 2, type: "normal" }] }],
    });
    await SleepSession.create({
      date: "2026-09-02",
      bedTime: new Date("2026-09-02T20:30:00.000Z"),
      wakeTime: new Date("2026-09-03T04:00:00.000Z"),
      midpoint: new Date("2026-09-03T00:15:00.000Z"),
    });

    const digest = await getWeeklyDigest("2026-09-01");

    expect(digest.workoutsLogged).toBe(1);
    expect(digest.totalProteinG).toBe(12);
    expect(digest.sleepSessionsLogged).toBe(1);
  });
});
