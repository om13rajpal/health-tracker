import { describe, it, expect } from "vitest";
import { normalizeHealthEvent } from "./ingestion-adapter.js";

describe("normalizeHealthEvent", () => {
  it("converts a valid payload into a Mongo-ready sample", () => {
    const normalized = normalizeHealthEvent({
      source: "ios-bridge",
      metric: "heart_rate",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 62,
      unit: "bpm",
    });
    expect(normalized.metric).toBe("heart_rate");
    expect(normalized.value).toBe(62);
    expect(normalized.timestamp).toBeInstanceOf(Date);
    expect(normalized.source).toBe("ios-bridge");
  });
});
