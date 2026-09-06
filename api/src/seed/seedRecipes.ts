import { Recipe } from "../models/Recipe.js";

const RECIPES = [
  {
    slug: "soya-chunk-masala",
    name: "Soya Chunk Masala",
    ingredients: [
      { name: "soya chunks (dry)", grams: 50 },
      { name: "onion", grams: 50 },
      { name: "tomato", grams: 50 },
      { name: "oil", grams: 10 },
    ],
    steps: [
      "Soak 50g dry soya chunks in hot water for 10 minutes, then squeeze out excess water.",
      "Heat oil in a pan on the induction, saute chopped onion until translucent.",
      "Add chopped tomato and spices, cook until softened.",
      "Add the soaked soya chunks, mix well, cover and cook 5 minutes.",
    ],
    equipment: ["pan", "induction"],
    prepMinutes: 20,
    macros: { calories: 350, proteinG: 27, carbsG: 20, fatG: 15 },
    tags: ["high-protein", "vegetarian"],
  },
  {
    slug: "egg-curry",
    name: "Egg Curry",
    ingredients: [
      { name: "eggs", grams: 100 },
      { name: "onion", grams: 50 },
      { name: "tomato", grams: 50 },
      { name: "oil", grams: 10 },
    ],
    steps: [
      "Boil 2 eggs in the pressure cooker, peel and set aside.",
      "Saute onion and tomato with spices in a pan on the induction.",
      "Add the boiled eggs to the gravy, simmer 5 minutes.",
    ],
    equipment: ["pan", "pressure_cooker", "induction"],
    prepMinutes: 20,
    macros: { calories: 310, proteinG: 16, carbsG: 8, fatG: 24 },
    tags: ["high-protein", "eggetarian"],
  },
];

export async function seedRecipes(): Promise<number> {
  let count = 0;
  for (const recipe of RECIPES) {
    await Recipe.findOneAndUpdate({ slug: recipe.slug }, recipe, { upsert: true });
    count += 1;
  }
  return count;
}
