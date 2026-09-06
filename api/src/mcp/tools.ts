import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { SleepSession } from "../models/SleepSession.js";
import { CoachNote } from "../models/CoachNote.js";

export type WeeklyDigest = {
  weekOf: string;
  workoutsLogged: number;
  totalProteinG: number;
  sleepSessionsLogged: number;
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateStrings(weekOf: string): string[] {
  const start = new Date(`${weekOf}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i).toISOString().slice(0, 10));
}

export async function getWeeklyDigest(weekOf: string): Promise<WeeklyDigest> {
  const dates = toDateStrings(weekOf);

  const [foodEntries, workoutSessions, sleepSessions] = await Promise.all([
    FoodEntry.find({ date: { $in: dates } }),
    WorkoutSession.find({ date: { $in: dates } }),
    SleepSession.find({ date: { $in: dates } }),
  ]);

  return {
    weekOf,
    workoutsLogged: workoutSessions.length,
    totalProteinG: foodEntries.reduce((sum, entry) => sum + entry.macros.proteinG, 0),
    sleepSessionsLogged: sleepSessions.length,
  };
}

export type SaveCoachNoteInput = {
  weekOf: string;
  summary: string;
  suggestions: string[];
  source: "vendor_scheduled_task" | "mcp_session";
  llmModel?: string;
};

export async function saveCoachNote(input: SaveCoachNoteInput) {
  const digest = await getWeeklyDigest(input.weekOf);
  return CoachNote.create({ ...input, digest });
}
