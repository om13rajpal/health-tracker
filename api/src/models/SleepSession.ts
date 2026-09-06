import { Schema, model } from "mongoose";

const sleepSessionSchema = new Schema({
  date: { type: String, required: true, unique: true },
  bedTime: { type: Date, required: true },
  wakeTime: { type: Date, required: true },
  midpoint: { type: Date, required: true },
  stages: {
    core: Number,
    deep: Number,
    rem: Number,
    awake: Number,
  },
  morningLightWithinMinutes: { type: Number },
  morningExercise: { type: Boolean },
  socialJetlagMinutes: { type: Number },
  // Same convention as WorkoutSession/FoodEntry: absent for a web-logged
  // night, "mcp" for one an AI session wrote directly.
  loggedVia: { type: String, enum: ["mcp"] },
  loggedByClient: { type: String },
});

export const SleepSession = model("SleepSession", sleepSessionSchema);
