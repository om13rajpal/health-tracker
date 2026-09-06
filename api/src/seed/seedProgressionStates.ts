import { ProgramTemplate } from "../models/ProgramTemplate.js";
import { ProgressionState } from "../models/ProgressionState.js";

export async function seedProgressionStates(): Promise<number> {
  const programs = await ProgramTemplate.find({});
  if (programs.length === 0) {
    throw new Error(
      "Cannot seed progression states: no ProgramTemplate documents found — run seedProgramTemplates first."
    );
  }

  let count = 0;
  for (const program of programs) {
    for (const exercise of program.exercises) {
      const phaseFields =
        program.phase === "bodyweight"
          ? { level: 0 }
          : { loadKg: exercise.startingLoadKg ?? 0, increment: exercise.increment ?? 2.5 };

      await ProgressionState.findOneAndUpdate(
        { exerciseId: exercise.exerciseSlug },
        {
          $setOnInsert: {
            exerciseId: exercise.exerciseSlug,
            phase: program.phase,
            // Barbell states carry the rep range too: repRangeLow doubles as the
            // prescribed reps-per-set that workouts.service.ts compares against.
            repRangeLow: exercise.repRangeLow,
            repRangeHigh: exercise.repRangeHigh,
            consecutiveTopOfRange: 0,
            consecutiveBelowRange: 0,
            consecutiveMisses: 0,
            ...phaseFields,
          },
        },
        { upsert: true }
      );
      count += 1;
    }
  }
  return count;
}
