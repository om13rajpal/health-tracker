import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { Recipe } from "../../models/Recipe.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await Recipe.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/recipes/suggestions", () => {
  it("ranks recipes within budget by protein density", async () => {
    await Recipe.create([
      { slug: "high-protein", name: "Soya Chunk Masala", ingredients: [{ name: "soya", grams: 50 }], steps: ["cook"], equipment: ["pan"], prepMinutes: 20, macros: { calories: 300, proteinG: 30, carbsG: 20, fatG: 10 }, tags: [] },
      { slug: "low-protein", name: "Plain Rice", ingredients: [{ name: "rice", grams: 150 }], steps: ["cook"], equipment: ["pressure_cooker"], prepMinutes: 15, macros: { calories: 200, proteinG: 4, carbsG: 43, fatG: 0.5 }, tags: [] },
      { slug: "over-budget", name: "Feast", ingredients: [{ name: "everything", grams: 500 }], steps: ["cook"], equipment: ["pan"], prepMinutes: 40, macros: { calories: 900, proteinG: 50, carbsG: 80, fatG: 30 }, tags: [] },
    ]);
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });
    const res = await agent.get("/api/recipes/suggestions?mealSlot=lunch&remainingProteinG=40&remainingCalories=400");
    expect(res.status).toBe(200);
    expect(res.body.map((r: { slug: string }) => r.slug)).toEqual(["high-protein", "low-protein"]);
  });

  it("rejects a non-numeric remainingCalories with 400", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });
    const res = await agent.get("/api/recipes/suggestions?remainingCalories=not-a-number");
    expect(res.status).toBe(400);
  });
});
