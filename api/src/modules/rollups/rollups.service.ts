import { DailyRollup } from "../../models/DailyRollup.js";
import { defaultIstHistoryWindow, toIstDateString } from "../../lib/dates.js";
import { computeDailyRollup } from "../../jobs/nightlyRollup.job.js";

export async function listRollups(from?: string, to?: string) {
  const window = from && to ? { from, to } : defaultIstHistoryWindow();
  const rollups = await DailyRollup.find({ date: { $gte: window.from, $lte: window.to } }).sort({ date: 1 }).lean();

  // The nightly job only ever computes "yesterday", once — today's own
  // totals would otherwise sit empty until after midnight. Recomputed live
  // on every read instead of cached, so it reflects whatever has synced so
  // far right now, not what had synced at some earlier point today.
  const today = toIstDateString(new Date());
  if (today >= window.from && today <= window.to) {
    const liveToday = await computeDailyRollup(today);
    const withoutToday = rollups.filter((r) => r.date !== today);
    withoutToday.push(liveToday.toObject());
    withoutToday.sort((a, b) => a.date.localeCompare(b.date));
    return withoutToday;
  }

  return rollups;
}
