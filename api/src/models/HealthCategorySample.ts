import { Schema, model } from "mongoose";
import { HealthCategoryMetricSchema } from "@health-tracker/shared";

// Sleep stages, stand hours, mindful sessions, and heart/audio/hygiene event
// markers — one model for every HKCategorySample type this app syncs, since
// they all share the same {category, value, time range} shape. Read-only:
// nothing in this app creates these.
const healthCategorySampleSchema = new Schema({
  source: { type: String, required: true },
  category: { type: String, required: true, enum: HealthCategoryMetricSchema.options },
  value: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const HealthCategorySample = model("HealthCategorySample", healthCategorySampleSchema);
