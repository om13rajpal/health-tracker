import type { SleepSessionInput } from "@health-tracker/shared";
import { SleepSession } from "../../models/SleepSession.js";
import { HealthCategorySample } from "../../models/HealthCategorySample.js";
import { defaultIstHistoryWindow, toIstDateString } from "../../lib/dates.js";
import type { WriteAttribution } from "../../lib/writeAttribution.js";

export async function logSleepSession(input: SleepSessionInput, attribution?: WriteAttribution) {
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
      ...attribution,
    },
    { upsert: true, returnDocument: "after" }
  );
}

export async function listSleepSessions(from?: string, to?: string) {
  const window = from && to ? { from, to } : defaultIstHistoryWindow();
  return SleepSession.find({ date: { $gte: window.from, $lte: window.to } }).sort({ date: 1 }).lean();
}

// A gap this long between one sleep_analysis segment ending and the next
// starting ends one night and starts the next — long enough that a brief
// wake-up mid-night stays part of the same night, short enough that an
// afternoon nap several hours later starts a new cluster instead of being
// folded into the night before it.
const NIGHT_GAP_MS = 2 * 60 * 60 * 1000;
// Filters out a stray nap or a single mis-clustered segment rather than
// creating a "night" a few minutes long.
const MIN_NIGHT_MINUTES = 60;

/**
 * Rebuilds every SleepSession HealthKit has data for, from the raw
 * sleep_analysis category samples the iOS bridge has synced — bedTime,
 * wakeTime, midpoint, and the stage breakdown the web app's "how the night
 * was spent" bar already renders whenever `stages` is present. A night with
 * no HealthKit data (Apple Health missed it) is left alone: only a manually
 * logged night lives there, and this never touches a date its own clustering
 * doesn't produce.
 *
 * Full recompute rather than touching just the newly-arrived sample's own
 * night: HealthKit segments arrive out of order (the iOS bridge's chunked
 * historical drain can deliver any part of any past night at any time), so
 * there's no cheap way to know in isolation which night a single new segment
 * completes. At this app's single-user scale (low thousands of segments)
 * re-clustering everything is inexpensive enough not to need to be clever.
 */
export async function syncSleepFromHealthKit() {
  const samples = await HealthCategorySample.find({ category: "sleep_analysis" })
    .sort({ startDate: 1 })
    .lean();

  const clusters: (typeof samples)[] = [];
  let current: typeof samples = [];

  for (const sample of samples) {
    const previous = current[current.length - 1];
    if (previous && sample.startDate.getTime() - previous.endDate.getTime() > NIGHT_GAP_MS) {
      clusters.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length) clusters.push(current);

  for (const cluster of clusters) {
    const bedTime = cluster[0].startDate;
    const wakeTime = cluster.reduce((max, s) => (s.endDate > max ? s.endDate : max), cluster[0].endDate);
    const totalMinutes = (wakeTime.getTime() - bedTime.getTime()) / 60_000;
    if (totalMinutes < MIN_NIGHT_MINUTES) continue;

    const minutesOf = (value: string) =>
      cluster
        .filter((s) => s.value === value)
        .reduce((sum, s) => sum + (s.endDate.getTime() - s.startDate.getTime()) / 60_000, 0);

    const midpoint = new Date((bedTime.getTime() + wakeTime.getTime()) / 2);
    // Named after the morning it ends, same as a manually logged night
    // ("Recorded against getTodayLocal()" at log time) — a night's identity
    // is the day you woke up into, not the evening you fell asleep.
    const date = toIstDateString(wakeTime);

    await SleepSession.findOneAndUpdate(
      { date },
      {
        date,
        bedTime,
        wakeTime,
        midpoint,
        stages: {
          core: minutesOf("asleep_core"),
          deep: minutesOf("asleep_deep"),
          rem: minutesOf("asleep_rem"),
          awake: minutesOf("awake"),
        },
      },
      { upsert: true }
    );
  }
}
