type SetLite = { reps: number; weight: number; rir?: number; type: string };
type ExerciseLite = { exerciseId: string; sets: SetLite[] };
export type WorkoutSessionLite = { date: string; exercises: ExerciseLite[] };
export type PR = { date: string; e1RM: number };

// Mirrors HARD_SET_MAX_RIR in api/src/jobs/nightlyRollup.job.ts. Today's rollup
// does not exist until that job runs overnight, so the dashboard counts today's
// hard sets itself — and has to count them the same way, or today's number
// would jump when the rollup lands.
const HARD_SET_MAX_RIR = 4;

export function countHardSets(sessions: WorkoutSessionLite[], date: string): number {
  return sessions
    .filter((s) => s.date === date)
    .reduce(
      (total, session) =>
        total +
        session.exercises.reduce(
          (sum, exercise) =>
            sum + exercise.sets.filter((set) => set.rir != null && set.rir <= HARD_SET_MAX_RIR).length,
          0
        ),
      0
    );
}

const MAX_REPS_FOR_E1RM = 12;
const PR_IMPROVEMENT_THRESHOLD = 1.01; // >=1% improvement to count, avoids noise

export function computeE1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

export function findPRs(sessions: WorkoutSessionLite[], exerciseId: string): PR[] {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const prs: PR[] = [];
  let bestE1RM = 0;

  for (const session of sorted) {
    for (const exercise of session.exercises) {
      if (exercise.exerciseId !== exerciseId) continue;
      for (const set of exercise.sets) {
        if (set.reps > MAX_REPS_FOR_E1RM) continue;
        const e1RM = computeE1RM(set.weight, set.reps);
        if (e1RM >= bestE1RM * PR_IMPROVEMENT_THRESHOLD) {
          prs.push({ date: session.date, e1RM });
          bestE1RM = e1RM;
        }
      }
    }
  }

  return prs;
}

export function computeConsistencyStreak(sessions: WorkoutSessionLite[], today: string): number {
  const loggedDates = new Set(sessions.map((s) => s.date));
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00.000Z`);

  while (loggedDates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}
