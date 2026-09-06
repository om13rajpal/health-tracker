import { Exercise } from "../models/Exercise.js";

const EXERCISES = [
  { slug: "bodyweight-squat", name: "Bodyweight Squat", muscleGroups: ["quadriceps", "glutes"], equipment: ["none"], images: [] },
  { slug: "glute-bridge", name: "Glute Bridge", muscleGroups: ["glutes", "hamstrings"], equipment: ["none"], images: [] },
  { slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: ["chest", "triceps", "shoulders"], equipment: ["none"], images: [] },
  { slug: "negative-pullup", name: "Negative Pull-Up", muscleGroups: ["back", "biceps"], equipment: ["pull-up bar"], images: [] },
  { slug: "inverted-row", name: "Inverted Row", muscleGroups: ["back", "biceps"], equipment: ["table or bar"], images: [] },
  { slug: "plank", name: "Plank", muscleGroups: ["core"], equipment: ["none"], images: [] },
  { slug: "dead-bug", name: "Dead Bug", muscleGroups: ["core"], equipment: ["none"], images: [] },
  { slug: "step-back-burpee", name: "Step-Back Burpee (No Jump)", muscleGroups: ["full body"], equipment: ["none"], images: [] },
  { slug: "back-squat", name: "Barbell Back Squat", muscleGroups: ["quadriceps", "glutes"], equipment: ["barbell", "rack"], images: [], homeEquivalentSlug: "bodyweight-squat" },
  { slug: "romanian-deadlift", name: "Romanian Deadlift", muscleGroups: ["hamstrings", "glutes"], equipment: ["barbell"], images: [], homeEquivalentSlug: "glute-bridge" },
  { slug: "bench-press", name: "Barbell Bench Press", muscleGroups: ["chest", "triceps", "shoulders"], equipment: ["barbell", "bench"], images: [], homeEquivalentSlug: "incline-pushup" },
  { slug: "lat-pulldown", name: "Lat Pulldown", muscleGroups: ["back", "biceps"], equipment: ["cable machine"], images: [], homeEquivalentSlug: "inverted-row" },
];

export async function seedExercises(): Promise<number> {
  let count = 0;
  for (const exercise of EXERCISES) {
    await Exercise.findOneAndUpdate({ slug: exercise.slug }, exercise, { upsert: true });
    count += 1;
  }
  return count;
}
