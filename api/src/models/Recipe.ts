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

const ingredientSchema = new Schema(
  {
    ifctRefId: { type: String },
    name: { type: String, required: true },
    grams: { type: Number, required: true },
  },
  { _id: false }
);

const recipeSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  ingredients: { type: [ingredientSchema], required: true },
  steps: { type: [String], required: true },
  equipment: { type: [String], required: true, enum: ["pan", "pressure_cooker", "induction"] },
  prepMinutes: { type: Number, required: true },
  macros: { type: macrosSchema, required: true },
  tags: { type: [String], default: [] },
});

export const Recipe = model("Recipe", recipeSchema);
