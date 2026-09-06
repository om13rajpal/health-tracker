import { z } from "zod";

export const SleepSessionInputSchema = z.object({
  date: z.string().min(1),
  bedTime: z.string().datetime(),
  wakeTime: z.string().datetime(),
  morningLightWithinMinutes: z.number().min(0).optional(),
  morningExercise: z.boolean().optional(),
});
export type SleepSessionInput = z.infer<typeof SleepSessionInputSchema>;
