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
  // Distinct from `source` above (that's the food's provenance — a dish, a
  // barcode, an LLM estimate). This is who made the write: absent for
  // anything logged through the web app, "mcp" for an entry an AI session
  // wrote directly via the MCP tools.
  loggedVia: { type: String, enum: ["mcp"] },
  loggedByClient: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const FoodEntry = model("FoodEntry", foodEntrySchema);
