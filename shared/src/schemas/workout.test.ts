import { describe, it, expect } from "vitest";
import { SetSchema, WorkoutSessionInputSchema } from "./workout.js";

describe("SetSchema", () => {
  it("accepts a normal set", () => {
    const result = SetSchema.safeParse({ reps: 10, weight: 20, rir: 2, type: "normal" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative rep count", () => {
    const result = SetSchema.safeParse({ reps: -1, weight: 20, type: "normal" });
    expect(result.success).toBe(false);
  });
});

describe("WorkoutSessionInputSchema", () => {
  it("accepts a session with one exercise and two sets", () => {
    const result = WorkoutSessionInputSchema.safeParse({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 12, weight: 0, type: "normal" },
            { reps: 10, weight: 0, type: "normal" },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a session with no exercises", () => {
    const result = WorkoutSessionInputSchema.safeParse({ date: "2026-09-06", exercises: [] });
    expect(result.success).toBe(false);
  });
});
