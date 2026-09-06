import { Schema, model } from "mongoose";
import { HealthMetricSchema } from "@health-tracker/shared";

const pendingWriteSchema = new Schema({
  metric: {
    type: String,
    required: true,
    enum: HealthMetricSchema.options,
  },
  value: { type: Number, required: true },
  unit: { type: String },
  timestamp: { type: Date, required: true },
  delivered: { type: Boolean, required: true, default: false },
  deliveredAt: { type: Date },
});

// The bridge polls `find({ delivered: false }).sort({ timestamp: 1 })` every
// time it foregrounds. Compound and in this order so the filter and the sort
// are both served by the index, never an in-memory sort.
pendingWriteSchema.index({ delivered: 1, timestamp: 1 });

export const PendingWrite = model("PendingWrite", pendingWriteSchema);
