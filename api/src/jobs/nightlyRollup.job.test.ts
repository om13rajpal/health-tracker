import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { HealthSample } from "../models/HealthSample.js";
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { SleepSession } from "../models/SleepSession.js";
import { DailyRollup } from "../models/DailyRollup.js";
import { computeDailyRollup } from "./nightlyRollup.job.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // HealthSample is a timeseries collection — its queryable view isn't
  // guaranteed to exist yet right after the first write races Model.init(),
  // and a find() against a not-yet-materialized view returns [] rather than
  // erroring. Waiting for every model's init() here up front is what
  // health-events.routes.test.ts already does for the exact same reason.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  await Promise.all([
    HealthSample.deleteMany({}),
    FoodEntry.deleteMany({}),
    WorkoutSession.deleteMany({}),
    SleepSession.deleteMany({}),
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

  it("averages resting heart rate, sums active energy, and takes the latest weight", async () => {
    await HealthSample.create([
      { timestamp: new Date("2026-09-06T02:00:00.000Z"), metric: "resting_heart_rate", value: 58, source: "ios-bridge" },
      { timestamp: new Date("2026-09-06T14:00:00.000Z"), metric: "resting_heart_rate", value: 62, source: "ios-bridge" },
      { timestamp: new Date("2026-09-06T09:00:00.000Z"), metric: "active_energy", value: 300, source: "ios-bridge" },
      { timestamp: new Date("2026-09-06T15:00:00.000Z"), metric: "active_energy", value: 150, source: "ios-bridge" },
      { timestamp: new Date("2026-09-06T08:00:00.000Z"), metric: "weight", value: 70.2, source: "ios-bridge" },
      { timestamp: new Date("2026-09-06T16:00:00.000Z"), metric: "weight", value: 70.0, source: "ios-bridge" },
    ]);

    const rollup = await computeDailyRollup("2026-09-06");

    expect(rollup.restingHeartRate).toBe(60); // average of 58 and 62
    expect(rollup.activeCalories).toBe(450); // sum of 300 and 150
    expect(rollup.weightKg).toBe(70.0); // the later of the two samples, not an average
  });

  it("leaves a metric untouched rather than clearing it when a re-run finds no samples", async () => {
    await DailyRollup.create({ date: "2026-09-06", totalSteps: 0, restingHeartRate: 59, weightKg: 71.1 });

    const rollup = await computeDailyRollup("2026-09-06");

    expect(rollup.restingHeartRate).toBe(59);
    expect(rollup.weightKg).toBe(71.1);
  });

  it("pulls sleepMidpoint from the SleepSession already synced for that date", async () => {
    const midpoint = new Date("2026-09-06T02:15:00.000Z");
    await SleepSession.create({
      date: "2026-09-06",
      bedTime: new Date("2026-09-05T22:30:00.000Z"),
      wakeTime: new Date("2026-09-06T06:00:00.000Z"),
      midpoint,
    });

    const rollup = await computeDailyRollup("2026-09-06");

    expect(rollup.sleepMidpoint?.toISOString()).toBe(midpoint.toISOString());
  });
});
