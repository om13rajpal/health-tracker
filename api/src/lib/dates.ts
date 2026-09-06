export const IST_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 5 * 60 + 30;

export function toIstDateString(date: Date): string {
  const istInstant = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return istInstant.toISOString().slice(0, 10);
}

export const DEFAULT_HISTORY_WINDOW_DAYS = 30;

// `date` columns hold client-supplied IST-local date strings, so the default
// window bounds must be IST dates too. Deriving them from UTC would exclude
// today's rows between 00:00 and 05:29 IST.
export function defaultIstHistoryWindow(days: number = DEFAULT_HISTORY_WINDOW_DAYS): {
  from: string;
  to: string;
} {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: toIstDateString(from), to: toIstDateString(to) };
}

export function istDateRangeUtc(dateStr: string): { start: Date; end: Date } {
  // Midnight IST on `dateStr`, expressed as the equivalent UTC instant.
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  start.setUTCMinutes(start.getUTCMinutes() - IST_OFFSET_MINUTES);

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}
