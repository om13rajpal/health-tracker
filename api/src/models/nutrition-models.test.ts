import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { IndianDish } from "./IndianDish.js";
import { PackagedFood } from "./PackagedFood.js";
import { FoodEntry } from "./FoodEntry.js";
import { Recipe } from "./Recipe.js";
import { CoachNote } from "./CoachNote.js";

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

describe("IndianDish", () => {
  it("stores per-serving macros for a cooked dish", async () => {
    const doc = await IndianDish.create({
      slug: "dal-tadka",
      name: "Dal Tadka",
      servingGrams: 200,
      macrosPerServing: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
      source: "INDB",
    });
    expect(doc.macrosPerServing.proteinG).toBe(12);
  });
});

describe("PackagedFood", () => {
  it("stores a barcode-scanned product isolated from IndianDish", async () => {
    const doc = await PackagedFood.create({
      barcode: "8901063001011",
      name: "Nutrela Soya Chunks",
      macrosPer100g: { calories: 345, proteinG: 52, carbsG: 33, fatG: 0.5 },
      source: "open_food_facts",
    });
    expect(doc.barcode).toBe("8901063001011");
  });
});

describe("FoodEntry", () => {
  it("stores a logged entry referencing an IndianDish", async () => {
    const doc = await FoodEntry.create({
      date: "2026-09-06",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
      addedFatGrams: 5,
    });
    expect(doc.mealSlot).toBe("lunch");
  });
});

describe("Recipe", () => {
  it("stores a hostel-cookable recipe with equipment tags", async () => {
    const doc = await Recipe.create({
      slug: "soya-chunk-masala",
      name: "Soya Chunk Masala",
      ingredients: [{ name: "soya chunks (dry)", grams: 50 }],
      steps: ["Soak soya chunks in hot water for 10 minutes.", "Saute with onion-tomato masala on induction."],
      equipment: ["pan", "induction"],
      prepMinutes: 20,
      macros: { calories: 260, proteinG: 26, carbsG: 22, fatG: 6 },
      tags: ["high-protein", "vegetarian"],
    });
    expect(doc.equipment).toContain("induction");
  });
});

describe("CoachNote", () => {
  it("stores an LLM-authored weekly note", async () => {
    const doc = await CoachNote.create({
      weekOf: "2026-09-01",
      digest: { proteinHitRate: 0.8 },
      summary: "Good protein consistency this week.",
      suggestions: ["Add a second dance session."],
      source: "mcp_session",
    });
    expect(doc.source).toBe("mcp_session");
  });
});
