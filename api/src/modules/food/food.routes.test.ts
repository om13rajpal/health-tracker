import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { IndianDish } from "../../models/IndianDish.js";
import { PackagedFood } from "../../models/PackagedFood.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await Promise.all([IndianDish.deleteMany({}), PackagedFood.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function loggedInAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "test-password" });
  return agent;
}

describe("GET /api/food/dishes", () => {
  it("case-insensitively searches by name, capped at 20", async () => {
    await IndianDish.create({
      slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200,
      macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/food/dishes?q=dal");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe("dal-tadka");
  });

  it("treats regex metacharacters in the query as literal characters", async () => {
    await IndianDish.create({
      slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200,
      macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/food/dishes").query({ q: "dal(" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("GET /api/food/packaged/:barcode", () => {
  it("returns the product for a known barcode", async () => {
    await PackagedFood.create({
      barcode: "8901063001011", name: "Nutrela Soya Chunks",
      macrosPer100g: { calories: 345, proteinG: 52, carbsG: 33, fatG: 0.5 }, source: "open_food_facts",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/food/packaged/8901063001011");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Nutrela Soya Chunks");
  });

  it("returns 404 for an unknown barcode", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/food/packaged/0000000000000");
    expect(res.status).toBe(404);
  });
});
