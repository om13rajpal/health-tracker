import "dotenv/config";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { connectDb, disconnectDb } from "../lib/db.js";
import { seedExercises } from "./seedExercises.js";
import { seedProgramTemplates } from "./seedProgramTemplates.js";
import { seedProgressionStates } from "./seedProgressionStates.js";
import { seedIndianDishes } from "./seedIndianDishes.js";
import { seedPackagedFoods } from "./seedPackagedFoods.js";
import { seedRecipes } from "./seedRecipes.js";

export async function runAllSeeds() {
  const exerciseCount = await seedExercises();
  const programCount = await seedProgramTemplates();
  // Must run after seedProgramTemplates — it reads the seeded program to know
  // which exercises need a starting ProgressionState. Without this step the
  // progression engine (Task 8) never activates against real workout data.
  const progressionStateCount = await seedProgressionStates();
  const dishCount = await seedIndianDishes();
  const packagedFoodCount = await seedPackagedFoods();
  const recipeCount = await seedRecipes();

  console.log(
    `Seeded: ${exerciseCount} exercises, ${programCount} programs, ${progressionStateCount} progression states, ${dishCount} dishes, ${packagedFoodCount} packaged foods, ${recipeCount} recipes`
  );
}

// Compare filesystem paths, not raw URL strings — import.meta.url percent-
// encodes characters like spaces (e.g. "%20"), while process.argv[1] does
// not, so a naive string comparison silently never matches on any path
// containing a space and this script would never run when invoked directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = loadEnv();
  await connectDb(env.mongoUri);
  await runAllSeeds();
  await disconnectDb();
}
