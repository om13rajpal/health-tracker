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

export const HealthSample = model("HealthSample", healthSampleSchema);
