import { Schema, model } from "mongoose";

const progressionStateSchema = new Schema({
  exerciseId: { type: String, required: true, unique: true },
  phase: { type: String, required: true, enum: ["bodyweight", "barbell"] },
  level: { type: Number, default: 0 },
  loadKg: { type: Number },
  increment: { type: Number },
  repRangeLow: { type: Number },
  repRangeHigh: { type: Number },
  consecutiveTopOfRange: { type: Number, default: 0 },
  consecutiveBelowRange: { type: Number, default: 0 },
  consecutiveMisses: { type: Number, default: 0 },
  lastDeloadAt: { type: Date },
});

export const ProgressionState = model("ProgressionState", progressionStateSchema);
