import { describe, it, expect } from "vitest";
import { HealthEventPayloadSchema, HealthMetricSchema } from "./health.js";

describe("HealthEventPayloadSchema", () => {
  it("accepts every one of the 63 quantity-sample metrics the iOS bridge syncs", () => {
    for (const metric of HealthMetricSchema.options) {
      const result = HealthEventPayloadSchema.safeParse({
        source: "ios-bridge",
        metric,
        timestamp: "2026-09-06T08:00:00.000Z",
        value: 1,
      });
      expect(result.success, `${metric} should be a valid metric`).toBe(true);
    }
  });

  it("accepts a valid heart-rate sample event", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "heart_rate",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 62,
      unit: "bpm",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an event with an unknown metric", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "not_a_real_metric",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an event missing a timestamp", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "steps",
      value: 100,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a timestamp with a numeric UTC offset, not only a bare Z suffix", () => {
    // HealthKit/iOS timestamps aren't guaranteed to be pre-normalized to UTC "Z" —
    // reject this and every sync payload from the iOS bridge app silently fails.
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "steps",
      timestamp: "2026-09-06T13:30:00.000+05:30",
      value: 100,
    });
    expect(result.success).toBe(true);
  });

  it("rejects sleep and workout as metrics — those go through /api/sleep and /api/workouts instead", () => {
    const sleepResult = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "sleep",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 1,
    });
    expect(sleepResult.success).toBe(false);

    const workoutResult = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "workout",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 1,
    });
    expect(workoutResult.success).toBe(false);
  });

  it("rejects an event with no value, since every remaining metric is a plain quantity sample", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "heart_rate",
      timestamp: "2026-09-06T08:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
