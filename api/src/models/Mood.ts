import { Schema, model } from "mongoose";

// HKStateOfMind (Apple's "State of Mind" mood logging, iOS 18+) — the user
// logs this themselves in the Health/Mindfulness app; this app only reads
// it. Read-only, same as HealthWorkout/HealthCategorySample.
const moodSchema = new Schema({
  source: { type: String, required: true },
  kind: { type: String, required: true, enum: ["momentary_emotion", "daily_mood"] },
  valence: { type: Number, required: true },
  valenceClassification: { type: String },
  labels: { type: [String], default: [] },
  associations: { type: [String], default: [] },
  date: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const Mood = model("Mood", moodSchema);
