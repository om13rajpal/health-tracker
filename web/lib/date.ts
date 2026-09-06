const IST_OFFSET_MINUTES = 5 * 60 + 30;

export function getTodayLocal(now: Date = new Date()): string {
  const istInstant = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return istInstant.toISOString().slice(0, 10);
}
