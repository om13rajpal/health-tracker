import { PackagedFood } from "../models/PackagedFood.js";

const PRODUCTS = [
  {
    barcode: "8901063001011",
    name: "Nutrela Soya Chunks",
    macrosPer100g: { calories: 345, proteinG: 52, carbsG: 33, fatG: 0.5 },
    source: "open_food_facts" as const,
  },
  {
    barcode: "5449000000996",
    name: "Coca-Cola Zero Sugar",
    macrosPer100g: { calories: 0.3, proteinG: 0, carbsG: 0, fatG: 0 },
    source: "open_food_facts" as const,
  },
];

export async function seedPackagedFoods(): Promise<number> {
  let count = 0;
  for (const product of PRODUCTS) {
    await PackagedFood.findOneAndUpdate({ barcode: product.barcode }, product, { upsert: true });
    count += 1;
  }
  return count;
}
