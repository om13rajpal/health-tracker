import type { HealthMetric } from "@health-tracker/shared";
import { HealthSample } from "../models/HealthSample.js";
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { SleepSession } from "../models/SleepSession.js";
import { DailyRollup } from "../models/DailyRollup.js";
import { istDateRangeUtc } from "../lib/dates.js";

// A dashboard-metric threshold, intentionally looser than the progression
// engine's spec-mandated MAX_RIR_TO_COUNT_AS_HARD (3) — do not unify them.
const HARD_SET_MAX_RIR = 4;

async function sumMetric(metric: HealthMetric, start: Date, end: Date): Promise<number | undefined> {
  const samples = await HealthSample.find({ metric, timestamp: { $gte: start, $lt: end } });
  if (samples.length === 0) return undefined;
  return samples.reduce((sum, sample) => sum + sample.value, 0);
}

async function averageMetric(metric: HealthMetric, start: Date, end: Date): Promise<number | undefined> {
  const samples = await HealthSample.find({ metric, timestamp: { $gte: start, $lt: end } });
  if (samples.length === 0) return undefined;
  return samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length;
}

async function latestMetric(metric: HealthMetric, start: Date, end: Date): Promise<number | undefined> {
  const latest = await HealthSample.findOne({ metric, timestamp: { $gte: start, $lt: end } }).sort({ timestamp: -1 });
  return latest?.value;
}

export async function computeDailyRollup(date: string) {
  const { start, end } = istDateRangeUtc(date);

  const totalSteps = (await sumMetric("steps", start, end)) ?? 0;
  const restingHeartRate = await averageMetric("resting_heart_rate", start, end);
  const activeCalories = await sumMetric("active_energy", start, end);
  const weightKg = await latestMetric("weight", start, end);

  const sleepSession = await SleepSession.findOne({ date });
  const sleepMidpoint = sleepSession?.midpoint;

  const foodEntries = await FoodEntry.find({ date });
  const proteinG = foodEntries.reduce((sum, entry) => sum + entry.macros.proteinG, 0);
  const totalCalories = foodEntries.reduce((sum, entry) => sum + entry.macros.calories, 0);

  const workoutSessions = await WorkoutSession.find({ date });
  const hardSets = workoutSessions.reduce((sum, session) => {
    return (
      sum +
      session.exercises.reduce((exerciseSum, exercise) => {
        // A set with no logged RIR is missing data, not confirmed maximal
        // effort — exclude it rather than defaulting it to "hard" (audit fix).
        // `!= null` also covers Mongoose's `null` typing for unset optional numbers.
        return (
          exerciseSum + exercise.sets.filter((set) => set.rir != null && set.rir <= HARD_SET_MAX_RIR).length
        );
      }, 0)
    );
  }, 0);

  return DailyRollup.findOneAndUpdate(
    { date },
    { date, totalSteps, restingHeartRate, activeCalories, weightKg, sleepMidpoint, proteinG, totalCalories, hardSets },
    { upsert: true, returnDocument: "after" }
  );
}
