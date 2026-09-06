import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { IndianDish } from "../../models/IndianDish.js";
import { parseNaturalLanguageFood, parsePhotoFood, type GeminiClient } from "./nutrition-parsing.service.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await IndianDish.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function fakeGeminiClient(response: string): GeminiClient {
  return { generateContent: async () => response, generateContentWithImage: async () => response };
}

describe("parseNaturalLanguageFood", () => {
  it("matches a Gemini-identified dish slug against IndianDish", async () => {
    await IndianDish.create({
      slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200,
      macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB",
    });
    const gemini = fakeGeminiClient(
      JSON.stringify({ items: [{ matchedSlug: "dal-tadka", isGravyOrCurry: true }] })
    );
    const draft = await parseNaturalLanguageFood("dal chawal", "lunch", gemini);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ source: "indian_dish", refId: "dal-tadka", name: "Dal Tadka" });
    expect(draft.needsAddedFatPrompt).toBe(true);
  });

  it("falls back to an llm_estimate when no dish/product match is found", async () => {
    const gemini = fakeGeminiClient(
      JSON.stringify({
        items: [{ matchedSlug: null, isGravyOrCurry: false, estimatedName: "Mystery Snack", estimatedMacros: { calories: 150, proteinG: 3, carbsG: 20, fatG: 6 } }],
      })
    );
    const draft = await parseNaturalLanguageFood("some random snack", "snack", gemini);
    expect(draft.items[0]).toMatchObject({ source: "llm_estimate", name: "Mystery Snack" });
    expect(draft.needsAddedFatPrompt).toBe(false);
  });

  it("throws a clear error when Gemini returns malformed JSON, rather than passing it through", async () => {
    const gemini = fakeGeminiClient("not json at all");
    await expect(parseNaturalLanguageFood("dal chawal", "lunch", gemini)).rejects.toThrow(/invalid.*response/i);
  });
});

describe("parsePhotoFood", () => {
  it("parses an image the same way as text, via the multimodal client", async () => {
    await IndianDish.create({
      slug: "paneer-bhurji", name: "Paneer Bhurji", servingGrams: 100,
      macrosPerServing: { calories: 265, proteinG: 16, carbsG: 6, fatG: 20 }, source: "INDB",
    });
    const gemini: GeminiClient = {
      generateContent: async () => "",
      generateContentWithImage: async () =>
        JSON.stringify({ items: [{ matchedSlug: "paneer-bhurji", isGravyOrCurry: false }] }),
    };
    const draft = await parsePhotoFood("base64-fake-image-data", "dinner", gemini);
    expect(draft.items[0]).toMatchObject({ source: "indian_dish", refId: "paneer-bhurji" });
  });
});
