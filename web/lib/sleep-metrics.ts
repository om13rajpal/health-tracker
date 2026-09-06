type SleepSessionLite = { date: string; midpoint?: string; wakeTime?: string };

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MINUTES_PER_DAY = 1440;
const RADIANS_PER_MINUTE = (2 * Math.PI) / MINUTES_PER_DAY;

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

// Timestamps are stored as UTC instants but the whole sleep protocol is keyed
// to IST wall-clock time, so times-of-day have to be read in IST.
function istMinutesSinceMidnight(iso: string): number {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

// Signed shortest distance around the 1440-minute clock, in (-720, 720].
// 23:50 and 00:10 are 20 minutes apart, not 23h40m.
function circularDeltaMinutes(from: number, to: number): number {
  return ((to - from + MINUTES_PER_DAY * 1.5) % MINUTES_PER_DAY) - MINUTES_PER_DAY / 2;
}

// Vector (sin/cos) mean picks a wrap-safe anchor; averaging the unwrapped
// offsets around it then recovers exact whole-minute results for the
// whole-minute inputs this app actually stores.
function circularMeanMinutes(minutes: number[]): number {
  let sin = 0;
  let cos = 0;
  for (const m of minutes) {
    sin += Math.sin(m * RADIANS_PER_MINUTE);
    cos += Math.cos(m * RADIANS_PER_MINUTE);
  }
  const anchor = Math.round(Math.atan2(sin, cos) / RADIANS_PER_MINUTE);
  const meanOffset = minutes.reduce((sum, m) => sum + circularDeltaMinutes(anchor, m), 0) / minutes.length;
  return (((anchor + meanOffset) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function computeSocialJetlag(sessions: SleepSessionLite[]): number | null {
  const weekday = sessions.filter((s) => !isWeekend(s.date) && s.midpoint);
  const weekend = sessions.filter((s) => isWeekend(s.date) && s.midpoint);
  if (weekday.length === 0 || weekend.length === 0) return null;

  const meanOf = (arr: SleepSessionLite[]) =>
    circularMeanMinutes(arr.map((s) => istMinutesSinceMidnight(s.midpoint!)));

  return Math.abs(circularDeltaMinutes(meanOf(weekday), meanOf(weekend)));
}

export function computeWakeTimeConsistency(sessions: SleepSessionLite[]): number | null {
  const withWake = sessions.filter((s) => s.wakeTime);
  if (withWake.length < 2) return null;

  const minutes = withWake.map((s) => istMinutesSinceMidnight(s.wakeTime!));
  // Unwrap around the circular mean, then take the ordinary sample standard
  // deviation of the offsets. Standard deviation is translation-invariant, so
  // this matches the plain linear result whenever the times don't straddle
  // midnight, and stays correct when they do.
  const anchor = Math.round(circularMeanMinutes(minutes));
  const offsets = minutes.map((m) => circularDeltaMinutes(anchor, m));
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const variance = offsets.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (offsets.length - 1);
  return Math.sqrt(variance);
}
