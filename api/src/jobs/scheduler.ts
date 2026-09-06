import cron from "node-cron";
import { computeDailyRollup } from "./nightlyRollup.job.js";
import { toIstDateString, IST_TIME_ZONE } from "../lib/dates.js";

export function scheduleNightlyRollup() {
  // Runs at 00:30 IST every day, rolling up the previous full IST day.
  // `timezone` here is what makes "30 0 * * *" mean 00:30 IST regardless of
  // the server's own timezone (e.g. a UTC-timezone Render instance) — without
  // it this would fire at 00:30 server time, which is 6:00 AM IST.
  cron.schedule(
    "30 0 * * *",
    async () => {
      const nowIst = new Date(Date.now());
      const yesterdayIst = new Date(nowIst.getTime() - 24 * 60 * 60 * 1000);
      const date = toIstDateString(yesterdayIst);
      await computeDailyRollup(date);
    },
    { timezone: IST_TIME_ZONE }
  );
}
