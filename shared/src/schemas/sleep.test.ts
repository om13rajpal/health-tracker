import { describe, it, expect } from "vitest";
import { SleepSessionInputSchema } from "./sleep.js";

describe("SleepSessionInputSchema", () => {
  it("accepts a session with bed and wake times", () => {
    const result = SleepSessionInputSchema.safeParse({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "2026-09-07T04:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a session where wakeTime is not a valid datetime", () => {
    const result = SleepSessionInputSchema.safeParse({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});
