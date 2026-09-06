import type { WorkoutSessionInput } from "@health-tracker/shared";
import { WorkoutSession } from "../../models/WorkoutSession.js";
import { ProgressionState } from "../../models/ProgressionState.js";
import { applyBodyweightSession, applyBarbellSession } from "./progression-engine.js";
import { defaultIstHistoryWindow } from "../../lib/dates.js";

export async function logWorkoutSession(input: WorkoutSessionInput) {
  const session = await WorkoutSession.create(input);

  const progressionResults: Record<string, unknown> = {};

  for (const exercise of input.exercises) {
    const state = await ProgressionState.findOne({ exerciseId: exercise.exerciseId });
    if (!state) continue;

    // Warm-ups are logged but must not gate progression: an 8-rep warm-up
    // against a 15-rep working target would fail the "every set hit the top"
    // check and block advancement forever.
    const workingSets = exercise.sets.filter((set) => set.type !== "warmup");
    // An empty array's .every() is vacuously true, which would read as "all
    // sets hit the top" — skip the exercise instead.
    if (workingSets.length === 0) continue;

    const repsPerSet = workingSets.map((set) => set.reps);

    if (state.phase === "bodyweight") {
      // Use the hardest (lowest-RIR) set to represent the exercise's effort —
      // not sets[0], which is often a warm-up and would misclassify a
      // genuinely hard session as easy (caught during this plan's audit).
      // No logged RIR is missing data, not confirmed maximal effort — matching
      // nightlyRollup.job.ts. Infinity fails the engine's hard-effort test, so
      // an unlogged session never counts toward advancement.
      const loggedRirValues = workingSets.map((set) => set.rir).filter((rir): rir is number => rir !== undefined);
      const hardestSetRir = loggedRirValues.length > 0 ? Math.min(...loggedRirValues) : Number.POSITIVE_INFINITY;

      const result = applyBodyweightSession(
        {
          phase: "bodyweight",
          level: state.level,
          repRangeLow: state.repRangeLow ?? 8,
          repRangeHigh: state.repRangeHigh ?? 15,
          consecutiveTopOfRange: state.consecutiveTopOfRange,
          consecutiveBelowRange: state.consecutiveBelowRange,
        },
        repsPerSet,
        hardestSetRir
      );
      state.level = result.nextState.level;
      state.consecutiveTopOfRange = result.nextState.consecutiveTopOfRange;
      state.consecutiveBelowRange = result.nextState.consecutiveBelowRange;
      await state.save();
      progressionResults[exercise.exerciseId] = result;
    } else {
      // The target comes from the program (seeded onto the state), not from
      // whatever the athlete happened to log first — otherwise the "hit all
      // prescribed reps" check compares the session against itself.
      const targetReps = state.repRangeLow ?? 5;
      const result = applyBarbellSession(
        {
          phase: "barbell",
          loadKg: state.loadKg ?? 0,
          increment: state.increment ?? 2.5,
          consecutiveMisses: state.consecutiveMisses,
        },
        repsPerSet,
        targetReps
      );
      state.loadKg = result.nextState.loadKg;
      state.consecutiveMisses = result.nextState.consecutiveMisses;
      if (result.deloaded) state.lastDeloadAt = new Date();
      await state.save();
      progressionResults[exercise.exerciseId] = result;
    }
  }

  return { session, progressionResults };
}

export async function listWorkoutSessions(from?: string, to?: string) {
  const window = from && to ? { from, to } : defaultIstHistoryWindow();
  return WorkoutSession.find({ date: { $gte: window.from, $lte: window.to } }).sort({ date: 1 }).lean();
}
