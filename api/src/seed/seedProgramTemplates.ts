import { ProgramTemplate } from "../models/ProgramTemplate.js";

const PROGRAMS = [
  {
    slug: "home-start-weeks-1-4",
    name: "Home Start (Weeks 1-4)",
    phase: "bodyweight" as const,
    exercises: [
      { exerciseSlug: "bodyweight-squat", sets: 3, repRangeLow: 10, repRangeHigh: 15 },
      { exerciseSlug: "glute-bridge", sets: 3, repRangeLow: 10, repRangeHigh: 15 },
      { exerciseSlug: "incline-pushup", sets: 3, repRangeLow: 8, repRangeHigh: 15 },
      { exerciseSlug: "negative-pullup", sets: 3, repRangeLow: 3, repRangeHigh: 5 },
      { exerciseSlug: "inverted-row", sets: 3, repRangeLow: 10, repRangeHigh: 15 },
      { exerciseSlug: "plank", sets: 3, repRangeLow: 30, repRangeHigh: 45 },
    ],
    weeklySchedule: [
      { day: "monday", activity: "strength-a" },
      { day: "tuesday", activity: "mobility-and-dance" },
      { day: "wednesday", activity: "strength-b" },
      { day: "thursday", activity: "easy-walk" },
      { day: "friday", activity: "strength-c" },
      { day: "saturday", activity: "walk-run-progression" },
      { day: "sunday", activity: "rest-or-stretch" },
    ],
  },
  {
    slug: "gym-transition",
    name: "Gym Transition",
    phase: "barbell" as const,
    exercises: [
      { exerciseSlug: "back-squat", sets: 3, repRangeLow: 5, repRangeHigh: 5, startingLoadKg: 40, increment: 5 },
      { exerciseSlug: "romanian-deadlift", sets: 3, repRangeLow: 8, repRangeHigh: 10, startingLoadKg: 40, increment: 5 },
      { exerciseSlug: "bench-press", sets: 3, repRangeLow: 5, repRangeHigh: 5, startingLoadKg: 30, increment: 2.5 },
      { exerciseSlug: "lat-pulldown", sets: 3, repRangeLow: 8, repRangeHigh: 12, startingLoadKg: 25, increment: 2.5 },
    ],
    weeklySchedule: [
      { day: "monday", activity: "strength-a" },
      { day: "wednesday", activity: "strength-b" },
      { day: "friday", activity: "strength-c" },
    ],
  },
];

export async function seedProgramTemplates(): Promise<number> {
  let count = 0;
  for (const program of PROGRAMS) {
    await ProgramTemplate.findOneAndUpdate({ slug: program.slug }, program, { upsert: true });
    count += 1;
  }
  return count;
}
