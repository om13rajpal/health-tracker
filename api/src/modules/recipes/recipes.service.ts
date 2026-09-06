import { Recipe } from "../../models/Recipe.js";

const OVER_BUDGET_TOLERANCE = 1.15;

export async function suggestRecipes(remainingCalories: number) {
  const candidates = await Recipe.find({
    "macros.calories": { $gt: 0, $lte: remainingCalories * OVER_BUDGET_TOLERANCE },
  });

  return candidates.sort((a, b) => {
    const densityA = a.macros.proteinG / a.macros.calories;
    const densityB = b.macros.proteinG / b.macros.calories;
    return densityB - densityA;
  });
}
