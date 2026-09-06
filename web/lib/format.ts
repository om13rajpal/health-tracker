const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Wall-clock time in IST. Timestamps are stored as UTC instants but every
 *  reading in this app is read against an Indian clock, so formatting in the
 *  browser's own zone would silently shift a 06:20 wake to 00:50. */
export function istClock(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
  const h = String(shifted.getUTCHours()).padStart(2, "0");
  const m = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function istMinutesOfDay(iso: string): number {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function clockFromMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const m = String(Math.round(wrapped % 60)).padStart(2, "0");
  return `${h}:${m}`;
}

export function durationHours(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 0 ? `${whole} h` : `${whole} h ${minutes} m`;
}

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function mediumDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "31 August" — for the Monday a coaching week is keyed to, where naming the
 *  weekday as well is redundant. */
export function weekDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long" });
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function count(n: number): string {
  return n.toLocaleString("en-IN");
}

/** Turns a slug like "back-squat" into "Back squat" for the cases where the
 *  exercise catalogue has not loaded yet. */
export function humanizeSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "pan, pressure cooker and induction" — an Oxford-free list, because these
 *  read as prose in a sentence rather than as a data field. */
export function sentenceList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000
  );
}

/** A programme that prescribes exactly five reps says "5 reps", not "5–5". */
export function repRange(low?: number, high?: number, withUnit = true): string {
  const unit = withUnit ? " reps" : "";
  if (low === undefined && high === undefined) return withUnit ? "the prescribed reps" : "—";
  if (low === undefined || high === undefined) return `${low ?? high}${unit}`;
  return low === high ? `${low}${unit}` : `${low}\u2013${high}${unit}`;
}
