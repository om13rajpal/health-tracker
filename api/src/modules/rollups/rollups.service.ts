import { DailyRollup } from "../../models/DailyRollup.js";
import { defaultIstHistoryWindow } from "../../lib/dates.js";

export async function listRollups(from?: string, to?: string) {
  const window = from && to ? { from, to } : defaultIstHistoryWindow();
  return DailyRollup.find({ date: { $gte: window.from, $lte: window.to } }).sort({ date: 1 }).lean();
}
