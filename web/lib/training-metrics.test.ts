import { describe, it, expect } from "vitest";
import { computeE1RM, findPRs, computeConsistencyStreak } from "./training-metrics";

describe("computeE1RM", () => {
  it("computes the Epley estimated 1RM", () => {
    // 1RM = weight * (1 + reps/30)
    expect(computeE1RM(100, 5)).toBeCloseTo(116.67, 1);
  });

  it("returns the weight itself for a 1-rep set", () => {
    expect(computeE1RM(100, 1)).toBeCloseTo(103.33, 1);
  });
});

describe("findPRs", () => {
  const sessions = [
    { date: "2026-08-01", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 5, weight: 100, type: "normal" as const }] }] },
    // e1RM ~116.67 -> ~119.0, a 2% improvement, above the 1% noise threshold
    { date: "2026-08-08", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 5, weight: 102, type: "normal" as const }] }] },
    // e1RM barely moves (~0.3%), must NOT count as a new PR
    { date: "2026-08-15", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 5, weight: 102.3, type: "normal" as const }] }] },
    // reps > 12, must be excluded from e1RM consideration entirely (formula error grows past 10-12 reps)
    { date: "2026-08-22", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 20, weight: 200, type: "normal" as const }] }] },
  ];

  it("flags only sessions with a >=1% e1RM improvement as PRs, ignores reps > 12", () => {
    const prs = findPRs(sessions, "back-squat");
    expect(prs).toHaveLength(2); // the first logged session, and the 2026-08-08 improvement
    expect(prs.map((pr) => pr.date)).toEqual(["2026-08-01", "2026-08-08"]);
  });
});

describe("computeConsistencyStreak", () => {
  it("counts consecutive calendar days with at least one session, ending today", () => {
    const today = "2026-09-06";
    const sessions = [
      { date: "2026-09-06", exercises: [] },
      { date: "2026-09-05", exercises: [] },
      { date: "2026-09-04", exercises: [] },
      { date: "2026-09-02", exercises: [] }, // gap on 09-03 breaks the streak
    ];
    expect(computeConsistencyStreak(sessions, today)).toBe(3);
  });

  it("returns 0 when there is no session today", () => {
    const sessions = [{ date: "2026-09-05", exercises: [] }];
    expect(computeConsistencyStreak(sessions, "2026-09-06")).toBe(0);
  });
});
