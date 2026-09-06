import { z } from "zod";

export const SetTypeSchema = z.enum(["warmup", "normal", "dropset", "failure", "amrap"]);

export const SetSchema = z.object({
  reps: z.number().int().min(0),
  weight: z.number().min(0),
  rir: z.number().min(0).max(10).optional(),
  type: SetTypeSchema,
});
export type Set = z.infer<typeof SetSchema>;

export const ReadinessSchema = z.object({
  sleepHours: z.number().min(0).max(24),
  soreness: z.number().int().min(1).max(5),
  motivation: z.number().int().min(1).max(5),
});
export type Readiness = z.infer<typeof ReadinessSchema>;

export const WorkoutSessionInputSchema = z.object({
  date: z.string().min(1),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().min(1),
        sets: z.array(SetSchema).min(1),
      })
    )
    .min(1),
  readiness: ReadinessSchema.optional(),
});
export type WorkoutSessionInput = z.infer<typeof WorkoutSessionInputSchema>;
