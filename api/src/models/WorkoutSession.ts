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
  // Absent on every session logged before this field existed, and on every
  // session logged through the web app's own form — only present for sessions
  // an MCP client (Claude, ChatGPT) wrote directly, so the dashboards can tag
  // them distinctly rather than presenting AI-authored data as if the person
  // logged it themselves.
  loggedVia: { type: String, enum: ["mcp"] },
  loggedByClient: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const WorkoutSession = model("WorkoutSession", workoutSessionSchema);
