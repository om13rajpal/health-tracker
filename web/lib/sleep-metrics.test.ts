import { describe, it, expect } from "vitest";
import { computeSocialJetlag, computeWakeTimeConsistency } from "./sleep-metrics";

describe("computeSocialJetlag", () => {
  it("returns the weekday-vs-weekend midpoint delta in minutes", () => {
    const sessions = [
      // Monday 2026-09-07, midpoint 00:00
      { date: "2026-09-07", midpoint: "2026-09-07T00:00:00.000Z" },
      // Saturday 2026-09-12, midpoint 01:00 (60 min later)
      { date: "2026-09-12", midpoint: "2026-09-12T01:00:00.000Z" },
    ];
    expect(computeSocialJetlag(sessions)).toBe(60);
  });

  it("returns null when there is no weekend data yet", () => {
    const sessions = [{ date: "2026-09-07", midpoint: "2026-09-07T00:00:00.000Z" }];
    expect(computeSocialJetlag(sessions)).toBeNull();
  });

  it("measures the short way round when the two midpoints straddle IST midnight", () => {
    const sessions = [
      // Monday, midpoint 23:50 IST (2026-09-07T18:20:00Z)
      { date: "2026-09-07", midpoint: "2026-09-07T18:20:00.000Z" },
      // Saturday, midpoint 00:10 IST (2026-09-11T18:40:00Z)
      { date: "2026-09-12", midpoint: "2026-09-11T18:40:00.000Z" },
    ];
    // 20 minutes apart, not 1420.
    expect(computeSocialJetlag(sessions)).toBeCloseTo(20, 6);
  });

  it("still measures correctly once the phase shift moves midpoints past UTC midnight", () => {
    const sessions = [
      // Monday, midpoint 04:00 IST == 22:30 UTC the previous day
      { date: "2026-09-07", midpoint: "2026-09-06T22:30:00.000Z" },
      // Saturday, midpoint 05:00 IST == 23:30 UTC the previous day
      { date: "2026-09-12", midpoint: "2026-09-11T23:30:00.000Z" },
    ];
    expect(computeSocialJetlag(sessions)).toBeCloseTo(60, 6);
  });
});

describe("computeWakeTimeConsistency", () => {
  it("returns 0 for identical wake times", () => {
    const sessions = [
      { date: "2026-09-05", wakeTime: "2026-09-05T04:00:00.000Z" },
      { date: "2026-09-06", wakeTime: "2026-09-06T04:00:00.000Z" },
    ];
    expect(computeWakeTimeConsistency(sessions)).toBe(0);
  });

  it("returns null for fewer than 2 sessions", () => {
    expect(computeWakeTimeConsistency([{ date: "2026-09-06", wakeTime: "2026-09-06T04:00:00.000Z" }])).toBeNull();
  });

  it("treats wake times either side of IST midnight as close together", () => {
    const sessions = [
      { date: "2026-09-05", wakeTime: "2026-09-05T18:20:00.000Z" }, // 23:50 IST
      { date: "2026-09-06", wakeTime: "2026-09-06T18:40:00.000Z" }, // 00:10 IST
    ];
    // Two points 20 minutes apart: sample stddev = sqrt(200) ~ 14.14 minutes,
    // not the ~1004 a linear reading of 1430 vs 10 would give.
    expect(computeWakeTimeConsistency(sessions)).toBeCloseTo(Math.sqrt(200), 6);
  });

  it("matches the plain linear stddev when the times don't wrap", () => {
    const sessions = [
      { date: "2026-09-05", wakeTime: "2026-09-05T04:00:00.000Z" }, // 09:30 IST
      { date: "2026-09-06", wakeTime: "2026-09-06T05:00:00.000Z" }, // 10:30 IST
    ];
    expect(computeWakeTimeConsistency(sessions)).toBeCloseTo(Math.sqrt(1800), 6);
  });
});
