import { Schema, model } from "mongoose";

const programExerciseSchema = new Schema(
  {
    exerciseSlug: { type: String, required: true },
    sets: { type: Number, required: true },
    repRangeLow: { type: Number, required: true },
    repRangeHigh: { type: Number, required: true },
    startingLoadKg: { type: Number },
    increment: { type: Number },
  },
  { _id: false }
);

const programTemplateSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  phase: { type: String, required: true, enum: ["bodyweight", "barbell"] },
  exercises: { type: [programExerciseSchema], default: [] },
  weeklySchedule: {
    type: [
      {
        day: { type: String, required: true },
        activity: { type: String, required: true },
      },
    ],
    default: [],
  },
});

export const ProgramTemplate = model("ProgramTemplate", programTemplateSchema);
