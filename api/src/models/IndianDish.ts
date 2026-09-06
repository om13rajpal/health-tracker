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

const indianDishSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  servingGrams: { type: Number, required: true },
  macrosPerServing: { type: macrosSchema, required: true },
  source: { type: String, required: true, enum: ["INDB", "IFCT2017"] },
});

export const IndianDish = model("IndianDish", indianDishSchema);
