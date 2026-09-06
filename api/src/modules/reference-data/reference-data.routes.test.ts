import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { Exercise } from "../../models/Exercise.js";
import { ProgramTemplate } from "../../models/ProgramTemplate.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  await Promise.all([Exercise.deleteMany({}), ProgramTemplate.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/exercises", () => {
  it("lists all exercises", async () => {
    await Exercise.create([
      { slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: ["chest"], equipment: ["none"], images: [] },
      { slug: "back-squat", name: "Barbell Back Squat", muscleGroups: ["quadriceps"], equipment: ["barbell", "rack"], images: [] },
    ]);
    const res = await request(createApp()).get("/api/exercises");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("filters by equipment", async () => {
    await Exercise.create([
      { slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: ["chest"], equipment: ["none"], images: [] },
      { slug: "back-squat", name: "Barbell Back Squat", muscleGroups: ["quadriceps"], equipment: ["barbell", "rack"], images: [] },
    ]);
    const res = await request(createApp()).get("/api/exercises?equipment=none");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe("incline-pushup");
  });
});

describe("GET /api/programs", () => {
  it("lists all program templates", async () => {
    await ProgramTemplate.create({
      slug: "home-start-weeks-1-4",
      name: "Home Start",
      phase: "bodyweight",
      exercises: [{ exerciseSlug: "incline-pushup", sets: 3, repRangeLow: 8, repRangeHigh: 15 }],
      weeklySchedule: [],
    });
    const res = await request(createApp()).get("/api/programs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].phase).toBe("bodyweight");
  });
});
