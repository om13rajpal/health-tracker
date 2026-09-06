import { describe, it, expect } from "vitest";
import { FoodEntryInputSchema } from "./food.js";

describe("FoodEntryInputSchema", () => {
  it("accepts a logged Indian dish with macros", () => {
    const result = FoodEntryInputSchema.safeParse({
      date: "2026-09-06",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
      addedFatGrams: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mealSlot", () => {
    const result = FoodEntryInputSchema.safeParse({
      date: "2026-09-06",
      mealSlot: "midnight-snack",
      source: "llm_estimate",
      macros: { calories: 100, proteinG: 5, carbsG: 10, fatG: 2 },
    });
    expect(result.success).toBe(false);
  });
});
