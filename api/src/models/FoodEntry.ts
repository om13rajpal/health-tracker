import { Schema, model } from "mongoose";

const macrosSchema = new Schema(
  {
    calories: { type: Number, required: true },
    proteinG: { type: Number, required: true },
    carbsG: { type: Number, required: true },
    fatG: { type: Number, required: true },
  },
  { _id: false }
);

const foodEntrySchema = new Schema({
  // Indexed: getDailyMacroSummary (Task 10) and computeDailyRollup (Task 12)
  // both query directly by date.
  date: { type: String, required: true, index: true },
  mealSlot: { type: String, required: true, enum: ["breakfast", "lunch", "dinner", "snack"] },
  source: { type: String, required: true, enum: ["indian_dish", "packaged_food", "llm_estimate"] },
  refId: { type: String },
  macros: { type: macrosSchema, required: true },
  addedFatGrams: { type: Number },
  createdAt: { type: Date, default: Date.now },
});

export const FoodEntry = model("FoodEntry", foodEntrySchema);
