import { Schema, model } from "mongoose";
import { HealthMetricSchema } from "@health-tracker/shared";

const healthSampleSchema = new Schema(
  {
    timestamp: { type: Date, required: true },
    metric: {
      type: String,
      required: true,
      enum: HealthMetricSchema.options,
    },
    value: { type: Number, required: true },
    unit: { type: String },
    source: { type: String, required: true },
  },
  {
    timeseries: {
      timeField: "timestamp",
      metaField: "metric",
      granularity: "minutes",
    },
  }
);

// A HealthKit anchored query re-delivers a metric's whole history whenever
// the app's local sync anchor is reset (e.g. an uninstall/reinstall wipes
// the UserDefaults it's stored in) — this index is what a pre-insert
// existence check in the route filters against to keep that idempotent
// instead of duplicating every sample.
healthSampleSchema.index({ metric: 1, timestamp: 1 });

export const HealthSample = model("HealthSample", healthSampleSchema);
