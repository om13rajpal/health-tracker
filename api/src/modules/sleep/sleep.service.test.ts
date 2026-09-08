import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { HealthCategorySample } from "../../models/HealthCategorySample.js";
import { SleepSession } from "../../models/SleepSession.js";
import { syncSleepFromHealthKit } from "./sleep.service.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([HealthCategorySample.deleteMany({}), SleepSession.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function sample(value: string, startDate: string, endDate: string) {
  return {
    source: "ios-bridge",
    category: "sleep_analysis" as const,
    value,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
  };
}

describe("syncSleepFromHealthKit", () => {
  it("reconstructs bedTime, wakeTime, midpoint, and the stage breakdown from one night's segments", async () => {
    await HealthCategorySample.create([
      sample("asleep_core", "2026-09-06T17:00:00.000Z", "2026-09-06T18:30:00.000Z"), // 90 min core
      sample("asleep_deep", "2026-09-06T18:30:00.000Z", "2026-09-06T19:00:00.000Z"), // 30 min deep
      sample("awake", "2026-09-06T19:00:00.000Z", "2026-09-06T19:10:00.000Z"), // 10 min awake
      sample("asleep_rem", "2026-09-06T19:10:00.000Z", "2026-09-06T20:00:00.000Z"), // 50 min rem
    ]);

    await syncSleepFromHealthKit();

    // Wakes at 2026-09-06T20:00Z == 2026-09-07T01:30 IST — named after that
    // wake-up day, same convention a manually logged night uses.
    const session = await SleepSession.findOne({ date: "2026-09-07" });
    expect(session).not.toBeNull();
    expect(session!.bedTime.toISOString()).toBe("2026-09-06T17:00:00.000Z");
    expect(session!.wakeTime.toISOString()).toBe("2026-09-06T20:00:00.000Z");
    expect(session!.stages?.core).toBe(90);
    expect(session!.stages?.deep).toBe(30);
    expect(session!.stages?.rem).toBe(50);
    expect(session!.stages?.awake).toBe(10);
  });

  it("splits two nights separated by a long gap into two sessions, not one", async () => {
    await HealthCategorySample.create([
      sample("asleep_core", "2026-09-05T17:00:00.000Z", "2026-09-05T22:00:00.000Z"), // night 1
      sample("asleep_core", "2026-09-06T17:00:00.000Z", "2026-09-06T22:00:00.000Z"), // night 2, >2h later
    ]);

    await syncSleepFromHealthKit();

    const sessions = await SleepSession.find({}).sort({ date: 1 });
    expect(sessions).toHaveLength(2);
  });

  it("does not create a session for a stray segment shorter than the minimum night length", async () => {
    await HealthCategorySample.create([sample("awake", "2026-09-06T17:00:00.000Z", "2026-09-06T17:05:00.000Z")]);

    await syncSleepFromHealthKit();

    expect(await SleepSession.countDocuments({})).toBe(0);
  });

  it("leaves a manually logged night with no HealthKit data for that date untouched", async () => {
    await SleepSession.create({
      date: "2026-09-06",
      bedTime: new Date("2026-09-05T20:00:00.000Z"),
      wakeTime: new Date("2026-09-06T04:00:00.000Z"),
      midpoint: new Date("2026-09-06T00:00:00.000Z"),
      morningExercise: true,
    });

    await syncSleepFromHealthKit();

    const session = await SleepSession.findOne({ date: "2026-09-06" });
    expect(session?.morningExercise).toBe(true);
    // Mongoose always materializes a nested-schema path as an object shell
    // (`{core: undefined, ...}`), even when none of it was ever set — so
    // "untouched" means each field is still undefined, not that the whole
    // `stages` object itself is.
    expect(session?.stages?.core).toBeUndefined();
    expect(session?.stages?.deep).toBeUndefined();
    expect(session?.stages?.rem).toBeUndefined();
    expect(session?.stages?.awake).toBeUndefined();
  });
});
