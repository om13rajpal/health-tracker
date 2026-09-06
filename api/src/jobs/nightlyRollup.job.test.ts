import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { HealthSample } from "../models/HealthSample.js";
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { DailyRollup } from "../models/DailyRollup.js";
import { computeDailyRollup } from "./nightlyRollup.job.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([
    HealthSample.deleteMany({}),
    FoodEntry.deleteMany({}),
    WorkoutSession.deleteMany({}),
    DailyRollup.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("computeDailyRollup", () => {
  it("sums steps (bucketed by IST day, not UTC day) and protein, and counts hard sets", async () => {
    await HealthSample.create([
      // Both within IST 2026-09-06 (00:00-23:59:59 IST == 2026-09-05T18:30Z to 2026-09-06T18:29:59.999Z).
      { timestamp: new Date("2026-09-06T09:00:00.000Z"), metric: "steps", value: 3000, source: "ios-bridge" },
      { timestamp: new Date("2026-09-06T18:00:00.000Z"), metric: "steps", value: 2000, source: "ios-bridge" },
      // This is 2026-09-06T19:00:00Z == 2026-09-07T00:30 IST — the NEXT IST day.
      // A naive UTC-day bucket would incorrectly include this in "2026-09-06".
      { timestamp: new Date("2026-09-06T19:00:00.000Z"), metric: "steps", value: 9999, source: "ios-bridge" },
    ]);
    await FoodEntry.create([
      { date: "2026-09-06", mealSlot: "lunch", source: "indian_dish", macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 } },
      { date: "2026-09-06", mealSlot: "dinner", source: "indian_dish", macros: { calories: 300, proteinG: 20, carbsG: 30, fatG: 10 } },
    ]);
    await WorkoutSession.create({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 12, weight: 0, rir: 2, type: "normal" },
            { reps: 10, weight: 0, rir: 5, type: "normal" },
            { reps: 8, weight: 0, type: "normal" }, // no RIR logged — must not count as a hard set
          ],
        },
      ],
    });

    const rollup = await computeDailyRollup("2026-09-06");

    expect(rollup.totalSteps).toBe(5000); // excludes the 9999 sample from the next IST day
    expect(rollup.proteinG).toBe(32);
    expect(rollup.hardSets).toBe(1); // only the RIR-2 set; RIR-5 and the RIR-less set don't count
  });
});
