"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./apiFetch";
import { getTodayLocal } from "./date";
import type { LedgerDay } from "../components/DayStrip";
import type { DomainKey } from "./domains";

export const PROTEIN_TARGET_G = 155;
export const STEP_TARGET = 10_000;
export const HARD_SET_TARGET = 6;
export const SLEEP_TARGET_HOURS = 8;

export type Rollup = {
  date: string;
  totalSteps: number;
  restingHeartRate?: number;
  activeCalories?: number;
  totalCalories?: number;
  weightKg?: number;
  sleepMidpoint?: string;
  proteinG: number;
  hardSets: number;
};

export type SleepSession = {
  date: string;
  bedTime: string;
  wakeTime: string;
  midpoint: string;
  stages?: { core?: number; deep?: number; rem?: number; awake?: number };
  morningLightWithinMinutes?: number;
  morningExercise?: boolean;
};

export type WorkoutSet = { reps: number; weight: number; rir?: number; type: string };
export type WorkoutSession = {
  date: string;
  exercises: { exerciseId: string; sets: WorkoutSet[] }[];
};

export type FoodEntry = {
  date: string;
  mealSlot: "breakfast" | "lunch" | "dinner" | "snack";
  source: string;
  refId?: string;
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
  addedFatGrams?: number;
};

export type NutritionSummary = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinTargetG: number;
  proteinHitRate: number;
};

export type ProgressionState = {
  exerciseId: string;
  phase: "bodyweight" | "barbell";
  level: number;
  loadKg?: number;
  increment?: number;
  repRangeLow?: number;
  repRangeHigh?: number;
  consecutiveTopOfRange: number;
  consecutiveBelowRange: number;
  consecutiveMisses: number;
};

export type CoachNote = {
  weekOf: string;
  summary: string;
  suggestions: string[];
  source: string;
  llmModel?: string;
  createdAt?: string;
};

/** Every read goes through here so a non-ok response is an error rather than
 *  an empty array that would be indistinguishable from "no data yet". */
async function readJson<T>(path: string, what: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed to load ${what}: ${res.status}`);
  return (await res.json()) as T;
}

export function isoDaysAgo(days: number, from: string = getTodayLocal()): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The default window everywhere: twelve weeks, which is one training block. */
export const WINDOW_DAYS = 84;

export function useRollups(days: number = WINDOW_DAYS) {
  const to = getTodayLocal();
  const from = isoDaysAgo(days, to);
  return useQuery({
    queryKey: ["rollups", from, to],
    queryFn: () => readJson<Rollup[]>(`/api/rollups?from=${from}&to=${to}`, "your daily totals"),
  });
}

export function useSleepSessions(days: number = WINDOW_DAYS) {
  const to = getTodayLocal();
  const from = isoDaysAgo(days, to);
  return useQuery({
    queryKey: ["sleep-sessions", from, to],
    queryFn: () => readJson<SleepSession[]>(`/api/sleep?from=${from}&to=${to}`, "your sleep record"),
  });
}

export function useWorkouts(days: number = WINDOW_DAYS) {
  const to = getTodayLocal();
  const from = isoDaysAgo(days, to);
  return useQuery({
    queryKey: ["workouts", from, to],
    queryFn: () => readJson<WorkoutSession[]>(`/api/workouts?from=${from}&to=${to}`, "your training sessions"),
  });
}

export function useNutritionSummary(date: string) {
  return useQuery({
    queryKey: ["nutrition-summary", date],
    queryFn: () => readJson<NutritionSummary>(`/api/nutrition/summary/${date}`, "today's macros"),
  });
}

export function useNutritionEntries(date: string) {
  return useQuery({
    queryKey: ["nutrition-entries", date],
    queryFn: () => readJson<FoodEntry[]>(`/api/nutrition/entries/${date}`, "today's meals"),
  });
}

export function useProgression() {
  return useQuery({
    queryKey: ["progression"],
    queryFn: () => readJson<ProgressionState[]>("/api/progression", "your progression targets"),
  });
}

export function useCoachNotes(limit = 12) {
  return useQuery({
    queryKey: ["coach-notes", limit],
    queryFn: () => readJson<CoachNote[]>(`/api/coach-notes?limit=${limit}`, "your coach notes"),
  });
}

/* ------------------------------------------------------------ day strip ---- */

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Folds the rollups and the sleep record into one continuous run of days.
 *  Days the API returned nothing for stay in the run as gaps — dropping them
 *  would compress the strip and hide exactly the weeks worth noticing. */
/** Today's rollup is written by the nightly job, so on any given afternoon it
 *  does not exist yet. Live readings for today are passed in here instead of
 *  letting the strip draw today as an empty day it is not. */
export type TodayLive = { hardSets?: number; proteinG?: number };

export function buildLedgerDays(
  rollups: Rollup[] | undefined,
  sleep: SleepSession[] | undefined,
  days: number = WINDOW_DAYS,
  live?: TodayLive
): LedgerDay[] {
  const byDate = new Map((rollups ?? []).map((r) => [r.date, r]));
  const sleepByDate = new Map((sleep ?? []).map((s) => [s.date, s]));
  const today = getTodayLocal();

  const out: LedgerDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = isoDaysAgo(i, today);
    const r = byDate.get(date);
    const s = sleepByDate.get(date);
    const sleepHours = s ? hoursBetween(s.bedTime, s.wakeTime) : null;
    const isToday = date === today;

    const hardSets = isToday && live?.hardSets !== undefined ? live.hardSets : r?.hardSets;
    const proteinG = isToday && live?.proteinG !== undefined ? live.proteinG : r?.proteinG;

    const readings: Record<DomainKey, number | null> = {
      train: hardSets === undefined ? null : clamp01(hardSets / HARD_SET_TARGET),
      eat: proteinG === undefined ? null : clamp01(proteinG / PROTEIN_TARGET_G),
      sleep: sleepHours === null ? null : clamp01(sleepHours / SLEEP_TARGET_HOURS),
      body: r ? clamp01(r.totalSteps / STEP_TARGET) : null,
    };

    out.push({
      date,
      readings,
      detail: {
        train: hardSets === undefined ? "no record" : `${hardSets} hard sets`,
        eat: proteinG === undefined ? "no record" : `${Math.round(proteinG)} g protein`,
        sleep: sleepHours === null ? "no record" : `${sleepHours.toFixed(1)} h`,
        body: r ? `${r.totalSteps.toLocaleString("en-IN")} steps` : "no record",
      },
    });
  }
  return out;
}
