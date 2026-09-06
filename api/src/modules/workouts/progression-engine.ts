export type BodyweightProgressionState = {
  phase: "bodyweight";
  level: number;
  repRangeLow: number;
  repRangeHigh: number;
  consecutiveTopOfRange: number;
  consecutiveBelowRange: number;
};

export type BarbellProgressionState = {
  phase: "barbell";
  loadKg: number;
  increment: number;
  consecutiveMisses: number;
};

export type BodyweightSessionResult = {
  nextState: BodyweightProgressionState;
  advanced: boolean;
  regressed: boolean;
};

export type BarbellSessionResult = {
  nextState: BarbellProgressionState;
  loadIncreased: boolean;
  deloaded: boolean;
};

const ADVANCE_AFTER_SESSIONS = 2;
const REGRESS_AFTER_SESSIONS = 3;
// The spec's progression bar (RIR <= 3). Deliberately stricter than
// nightlyRollup.job.ts's HARD_SET_MAX_RIR, which is a dashboard metric — do not
// unify them.
const MAX_RIR_TO_COUNT_AS_HARD = 3;
const DELOAD_AFTER_MISSES = 3;
const DELOAD_FACTOR = 0.9;

export function applyBodyweightSession(
  state: BodyweightProgressionState,
  repsPerSet: number[],
  selfReportedRIR: number
): BodyweightSessionResult {
  const allSetsHitTop = repsPerSet.every((reps) => reps >= state.repRangeHigh);
  const anySetBelowLow = repsPerSet.some((reps) => reps < state.repRangeLow);
  const wasHardEffort = selfReportedRIR <= MAX_RIR_TO_COUNT_AS_HARD;

  let consecutiveTopOfRange = state.consecutiveTopOfRange;
  let consecutiveBelowRange = state.consecutiveBelowRange;

  if (allSetsHitTop && wasHardEffort) {
    consecutiveTopOfRange += 1;
    consecutiveBelowRange = 0;
  } else if (anySetBelowLow) {
    consecutiveBelowRange += 1;
    consecutiveTopOfRange = 0;
  } else {
    consecutiveTopOfRange = 0;
    consecutiveBelowRange = 0;
  }

  let level = state.level;
  let advanced = false;
  let regressed = false;

  if (consecutiveTopOfRange >= ADVANCE_AFTER_SESSIONS) {
    level += 1;
    consecutiveTopOfRange = 0;
    advanced = true;
  }

  if (consecutiveBelowRange >= REGRESS_AFTER_SESSIONS) {
    level = Math.max(0, level - 1);
    consecutiveBelowRange = 0;
    regressed = true;
  }

  return {
    nextState: { ...state, level, consecutiveTopOfRange, consecutiveBelowRange },
    advanced,
    regressed,
  };
}

export function applyBarbellSession(
  state: BarbellProgressionState,
  repsPerSet: number[],
  targetReps: number
): BarbellSessionResult {
  const hitAllPrescribedReps = repsPerSet.every((reps) => reps >= targetReps);

  let loadKg = state.loadKg;
  let consecutiveMisses = state.consecutiveMisses;
  let loadIncreased = false;
  let deloaded = false;

  if (hitAllPrescribedReps) {
    loadKg += state.increment;
    consecutiveMisses = 0;
    loadIncreased = true;
  } else {
    consecutiveMisses += 1;
  }

  if (consecutiveMisses >= DELOAD_AFTER_MISSES) {
    loadKg = Math.round(loadKg * DELOAD_FACTOR * 10) / 10;
    consecutiveMisses = 0;
    deloaded = true;
  }

  return {
    nextState: { ...state, loadKg, consecutiveMisses },
    loadIncreased,
    deloaded,
  };
}
