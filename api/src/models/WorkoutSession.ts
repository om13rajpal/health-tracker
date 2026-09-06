import { Schema, model } from "mongoose";

const setSchema = new Schema(
  {
    reps: { type: Number, required: true },
    weight: { type: Number, required: true },
    rir: { type: Number },
    type: {
      type: String,
      required: true,
      enum: ["warmup", "normal", "dropset", "failure", "amrap"],
    },
  },
  { _id: false }
);

const workoutExerciseSchema = new Schema(
  {
    exerciseId: { type: String, required: true },
    sets: { type: [setSchema], required: true },
  },
  { _id: false }
);

const readinessSchema = new Schema(
  {
    sleepHours: { type: Number },
    soreness: { type: Number },
    motivation: { type: Number },
  },
  { _id: false }
);

const workoutSessionSchema = new Schema({
  // Indexed: computeDailyRollup (Task 12) and getWeeklyDigest (Task 14) both
  // query directly by date.
  date: { type: String, required: true, index: true },
  exercises: { type: [workoutExerciseSchema], required: true },
  readiness: { type: readinessSchema },
  createdAt: { type: Date, default: Date.now },
});

export const WorkoutSession = model("WorkoutSession", workoutSessionSchema);
