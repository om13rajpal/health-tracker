import { Schema, model } from "mongoose";

// Deliberately separate from WorkoutSession, which is this app's own
// manually-logged strength-training model (exercises/sets/reps/weight,
// feeding the progression engine) — an HKWorkout (a run, ride, swim, etc.
// tracked by Apple Watch or the Fitness app) has an incompatible shape and
// no relationship to that data. Read-only: nothing in this app creates
// HKWorkout data, so there is no write-back path for this model.
const healthWorkoutSchema = new Schema({
  source: { type: String, required: true },
  activityType: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  durationSeconds: { type: Number, required: true },
  totalEnergyBurnedKcal: { type: Number },
  totalDistanceMeters: { type: Number },
  createdAt: { type: Date, default: Date.now },
});

export const HealthWorkout = model("HealthWorkout", healthWorkoutSchema);
