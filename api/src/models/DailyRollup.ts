import { Schema, model } from "mongoose";

const dailyRollupSchema = new Schema({
  date: { type: String, required: true, unique: true },
  totalSteps: { type: Number, default: 0 },
  restingHeartRate: { type: Number },
  activeCalories: { type: Number },
  totalCalories: { type: Number },
  weightKg: { type: Number },
  sleepMidpoint: { type: Date },
  proteinG: { type: Number, default: 0 },
  hardSets: { type: Number, default: 0 },
});

export const DailyRollup = model("DailyRollup", dailyRollupSchema);
