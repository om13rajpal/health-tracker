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

const packagedFoodSchema = new Schema({
  barcode: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  macrosPer100g: { type: macrosSchema, required: true },
  source: { type: String, required: true, enum: ["open_food_facts"] },
});

export const PackagedFood = model("PackagedFood", packagedFoodSchema);
