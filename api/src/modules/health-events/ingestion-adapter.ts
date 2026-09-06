import type { HealthEventPayload, HealthMetric } from "@health-tracker/shared";

export type NormalizedHealthSample = {
  timestamp: Date;
  metric: HealthMetric;
  value: number;
  unit?: string;
  source: string;
};

export function normalizeHealthEvent(payload: HealthEventPayload): NormalizedHealthSample {
  return {
    timestamp: new Date(payload.timestamp),
    metric: payload.metric,
    value: payload.value,
    unit: payload.unit,
    source: payload.source,
  };
}
