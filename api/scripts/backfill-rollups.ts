// One-off maintenance script — not part of the deployed app, not imported
// anywhere. Catches the DailyRollup collection up to everything HealthKit
// has already synced, since the nightly job only ever computes "yesterday",
// once, and would otherwise take months of cron cycles to revisit every
// historical day the still-draining iOS backlog eventually fills in.
// Run with: MONGO_URI="..." pnpm exec tsx scripts/backfill-rollups.ts
import mongoose from "mongoose";
import { HealthSample } from "../src/models/HealthSample.js";
import { WorkoutSession } from "../src/models/WorkoutSession.js";
import { FoodEntry } from "../src/models/FoodEntry.js";
import { computeDailyRollup } from "../src/jobs/nightlyRollup.job.js";
import { syncSleepFromHealthKit } from "../src/modules/sleep/sleep.service.js";
import { toIstDateString } from "../src/lib/dates.js";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is required");

  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  console.log("Syncing sleep sessions from HealthKit...");
  await syncSleepFromHealthKit();

  const dateStrings = new Set<string>();

  const healthSamples = await HealthSample.find({}, { timestamp: 1 }).lean();
  for (const s of healthSamples) dateStrings.add(toIstDateString(s.timestamp));

  const workouts = await WorkoutSession.find({}, { date: 1 }).lean();
  for (const w of workouts) dateStrings.add(w.date);

  const foodEntries = await FoodEntry.find({}, { date: 1 }).lean();
  for (const f of foodEntries) dateStrings.add(f.date);

  const dates = [...dateStrings].sort();
  console.log(`Recomputing rollups for ${dates.length} distinct dates...`);

  for (const date of dates) {
    await computeDailyRollup(date);
  }

  console.log("Done.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
