import { z } from "zod";

export const MealSlotSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export const FoodSourceSchema = z.enum(["indian_dish", "packaged_food", "llm_estimate"]);

export const MacrosSchema = z.object({
  calories: z.number().min(0),
  proteinG: z.number().min(0),
  carbsG: z.number().min(0),
  fatG: z.number().min(0),
});
export type Macros = z.infer<typeof MacrosSchema>;

export const FoodEntryInputSchema = z.object({
  date: z.string().min(1),
  mealSlot: MealSlotSchema,
  source: FoodSourceSchema,
  refId: z.string().optional(),
  macros: MacrosSchema,
  addedFatGrams: z.number().min(0).optional(),
});
export type FoodEntryInput = z.infer<typeof FoodEntryInputSchema>;
