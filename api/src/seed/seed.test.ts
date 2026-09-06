import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { seedExercises } from "./seedExercises.js";
import { seedIndianDishes } from "./seedIndianDishes.js";
import { seedProgramTemplates } from "./seedProgramTemplates.js";
import { seedProgressionStates } from "./seedProgressionStates.js";
import { Exercise } from "../models/Exercise.js";
import { IndianDish } from "../models/IndianDish.js";
import { ProgramTemplate } from "../models/ProgramTemplate.js";
import { ProgressionState } from "../models/ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([
    Exercise.deleteMany({}),
    IndianDish.deleteMany({}),
    ProgramTemplate.deleteMany({}),
    ProgressionState.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("seedExercises", () => {
  it("inserts exercises and is idempotent on re-run", async () => {
    const firstCount = await seedExercises();
    const afterFirst = await Exercise.countDocuments();
    const secondCount = await seedExercises();
    const afterSecond = await Exercise.countDocuments();

    expect(firstCount).toBeGreaterThan(0);
    expect(afterFirst).toBe(afterSecond);
    expect(secondCount).toBe(firstCount);
  });
});

describe("seedIndianDishes", () => {
  it("inserts dal tadka with correct macros", async () => {
    await seedIndianDishes();
    const dish = await IndianDish.findOne({ slug: "dal-tadka" });
    expect(dish).not.toBeNull();
    expect(dish?.macrosPerServing.proteinG).toBeGreaterThan(0);
  });
});

describe("seedProgramTemplates", () => {
  it("inserts the home-start bodyweight program", async () => {
    await seedProgramTemplates();
    const program = await ProgramTemplate.findOne({ slug: "home-start-weeks-1-4" });
    expect(program).not.toBeNull();
    expect(program?.phase).toBe("bodyweight");
    expect(program?.exercises.length).toBeGreaterThan(0);
  });
});

describe("seedProgressionStates", () => {
  it("creates one starting ProgressionState per exercise across every seeded program", async () => {
    await seedProgramTemplates();
    const programs = await ProgramTemplate.find({});
    const totalExercises = programs.reduce((sum, program) => sum + program.exercises.length, 0);

    const count = await seedProgressionStates();

    expect(programs.length).toBeGreaterThan(1);
    expect(count).toBe(totalExercises);

    const state = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(state).not.toBeNull();
    expect(state?.phase).toBe("bodyweight");
    expect(state?.level).toBe(0);
    expect(state?.repRangeLow).toBe(8);
    expect(state?.repRangeHigh).toBe(15);
  });

  it("seeds barbell states with a starting load and increment so barbell progression is reachable", async () => {
    await seedProgramTemplates();
    await seedProgressionStates();

    const squat = await ProgressionState.findOne({ exerciseId: "back-squat" });
    expect(squat).not.toBeNull();
    expect(squat?.phase).toBe("barbell");
    expect(squat?.loadKg).toBe(40);
    expect(squat?.increment).toBe(5);
    // repRangeLow is the prescribed reps-per-set the progression engine
    // compares each logged set against.
    expect(squat?.repRangeLow).toBe(5);

    const bench = await ProgressionState.findOne({ exerciseId: "bench-press" });
    expect(bench?.loadKg).toBe(30);
    expect(bench?.increment).toBe(2.5);
  });

  it("does not overwrite progress already made on a re-run", async () => {
    await seedProgramTemplates();
    await seedProgressionStates();

    await ProgressionState.findOneAndUpdate({ exerciseId: "incline-pushup" }, { level: 3, consecutiveTopOfRange: 1 });
    await ProgressionState.findOneAndUpdate({ exerciseId: "back-squat" }, { loadKg: 62.5, consecutiveMisses: 2 });

    await seedProgressionStates();

    const bodyweight = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(bodyweight?.level).toBe(3);
    expect(bodyweight?.consecutiveTopOfRange).toBe(1);

    const barbell = await ProgressionState.findOne({ exerciseId: "back-squat" });
    expect(barbell?.loadKg).toBe(62.5);
    expect(barbell?.consecutiveMisses).toBe(2);
  });
});
