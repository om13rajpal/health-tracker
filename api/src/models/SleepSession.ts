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
});

export const SleepSession = model("SleepSession", sleepSessionSchema);
