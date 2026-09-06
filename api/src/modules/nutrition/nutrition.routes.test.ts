import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { FoodEntry } from "../../models/FoodEntry.js";
import { IndianDish } from "../../models/IndianDish.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await FoodEntry.deleteMany({});
  await IndianDish.deleteMany({});
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

describe("nutrition routes", () => {
  it("logs a food entry and includes it in the day's summary", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    const logRes = await agent.post("/api/nutrition/entries").send({
      date: "2026-09-06",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
    });
    expect(logRes.status).toBe(201);

    const summaryRes = await agent.get("/api/nutrition/summary/2026-09-06");
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.proteinG).toBe(12);
    expect(summaryRes.body.calories).toBe(220);
  });

  it("counts addedFatGrams toward the day's fat and calories", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    await agent.post("/api/nutrition/entries").send({
      date: "2026-09-06",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
      addedFatGrams: 15,
    });

    const res = await agent.get("/api/nutrition/summary/2026-09-06");
    expect(res.status).toBe(200);
    expect(res.body.fatG).toBe(21); // 6 from the dish + 15 of ghee
    expect(res.body.calories).toBe(355); // 220 + 15 * 9
    expect(res.body.proteinG).toBe(12); // unchanged
  });

  it("returns zeroed macros for a day with no entries", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/nutrition/summary/2026-09-01");
    expect(res.status).toBe(200);
    expect(res.body.proteinG).toBe(0);
    expect(res.body.proteinHitRate).toBe(0);
  });
});

describe("GET /api/nutrition/entries/:date", () => {
  it("lists the raw entries logged for a date", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    await agent.post("/api/nutrition/entries").send({
      date: "2026-09-06", mealSlot: "lunch", source: "indian_dish", refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
    });
    const res = await agent.get("/api/nutrition/entries/2026-09-06");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].mealSlot).toBe("lunch");
  });
});

describe("POST /api/nutrition/parse", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "placeholder-key-for-tests";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ items: [{ matchedSlug: "dal-tadka", isGravyOrCurry: true }] }) }] } },
            ],
          })
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an editable draft without saving anything", async () => {
    await IndianDish.create({
      slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200,
      macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.post("/api/nutrition/parse").send({ text: "dal chawal", mealSlot: "lunch" });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    const entries = await FoodEntry.find({});
    expect(entries).toHaveLength(0); // never auto-saves
  });

  it("rejects an empty text field with 400", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.post("/api/nutrition/parse").send({ text: "", mealSlot: "lunch" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid mealSlot with 400", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.post("/api/nutrition/parse").send({ text: "dal chawal", mealSlot: "midnight-snack" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/nutrition/parse-photo", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "placeholder-key-for-tests";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ items: [{ matchedSlug: "paneer-bhurji", isGravyOrCurry: false }] }) }] } },
            ],
          })
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an editable draft from a base64 image, without saving anything", async () => {
    await IndianDish.create({
      slug: "paneer-bhurji", name: "Paneer Bhurji", servingGrams: 100,
      macrosPerServing: { calories: 265, proteinG: 16, carbsG: 6, fatG: 20 }, source: "INDB",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.post("/api/nutrition/parse-photo").send({ image: "base64-fake-image-data", mealSlot: "dinner" });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    const entries = await FoodEntry.find({});
    expect(entries).toHaveLength(0);
  });

  it("rejects an invalid mealSlot on the photo route with 400", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.post("/api/nutrition/parse-photo").send({ image: "base64data", mealSlot: "brunch" });
    expect(res.status).toBe(400);
  });
});
