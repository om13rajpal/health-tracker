import type { FoodEntryInput } from "@health-tracker/shared";
import { FoodEntry } from "../../models/FoodEntry.js";
import type { WriteAttribution } from "../../lib/writeAttribution.js";

// Accepted tradeoff, flagged during this plan's audit: this is a hardcoded
// constant, not a per-user stored/configurable value, even though the spec's
// own nutrition targets call for recalibrating every 2-3 weeks off real
// weigh-ins. For a single-user app this is a one-line code change + redeploy
// when that recalibration happens — acceptable for this plan's scope, but if
// recalibration ends up happening often, move this into a small `Settings`
// document instead of continuing to hardcode it.
const DAILY_PROTEIN_TARGET_G = 155;

const KCAL_PER_GRAM_OF_FAT = 9;

export async function logFoodEntry(input: FoodEntryInput, attribution?: WriteAttribution) {
  return FoodEntry.create({ ...input, ...attribution });
}

export async function getDailyMacroSummary(date: string) {
  const entries = await FoodEntry.find({ date });

  // Cooking oil/ghee is recorded separately from the dish's own macros
  // (a restaurant dal and a home dal differ mostly by this), so it has to be
  // folded into the totals here or the day silently understates fat and
  // calories on exactly the meals the field exists for.
  const totals = entries.reduce(
    (acc, entry) => {
      const addedFatG = entry.addedFatGrams ?? 0;
      return {
        calories: acc.calories + entry.macros.calories + addedFatG * KCAL_PER_GRAM_OF_FAT,
        proteinG: acc.proteinG + entry.macros.proteinG,
        carbsG: acc.carbsG + entry.macros.carbsG,
        fatG: acc.fatG + entry.macros.fatG + addedFatG,
      };
    },
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  return {
    ...totals,
    proteinTargetG: DAILY_PROTEIN_TARGET_G,
    proteinHitRate: Math.min(1, totals.proteinG / DAILY_PROTEIN_TARGET_G),
  };
}

export async function listFoodEntriesForDate(date: string) {
  return FoodEntry.find({ date }).lean();
}
