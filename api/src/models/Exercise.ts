import { Schema, model } from "mongoose";

const exerciseSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  muscleGroups: { type: [String], default: [] },
  equipment: { type: [String], default: [] },
  images: { type: [String], default: [] },
  homeEquivalentSlug: { type: String },
});

export const Exercise = model("Exercise", exerciseSchema);
