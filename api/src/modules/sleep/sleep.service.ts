import type { SleepSessionInput } from "@health-tracker/shared";
import { SleepSession } from "../../models/SleepSession.js";
import { defaultIstHistoryWindow } from "../../lib/dates.js";

export async function logSleepSession(input: SleepSessionInput) {
  const bedTime = new Date(input.bedTime);
  const wakeTime = new Date(input.wakeTime);
  const midpoint = new Date((bedTime.getTime() + wakeTime.getTime()) / 2);

  return SleepSession.findOneAndUpdate(
    { date: input.date },
    {
      date: input.date,
      bedTime,
      wakeTime,
      midpoint,
      morningLightWithinMinutes: input.morningLightWithinMinutes,
      morningExercise: input.morningExercise,
    },
    { upsert: true, returnDocument: "after" }
  );
}

export async function listSleepSessions(from?: string, to?: string) {
  const window = from && to ? { from, to } : defaultIstHistoryWindow();
  return SleepSession.find({ date: { $gte: window.from, $lte: window.to } }).sort({ date: 1 }).lean();
}
