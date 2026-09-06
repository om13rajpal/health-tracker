import { IndianDish } from "../models/IndianDish.js";

const DISHES = [
  { slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200, macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB" as const },
  { slug: "roti", name: "Roti (whole wheat)", servingGrams: 40, macrosPerServing: { calories: 120, proteinG: 3, carbsG: 22, fatG: 2 }, source: "IFCT2017" as const },
  { slug: "rajma", name: "Rajma (cooked)", servingGrams: 150, macrosPerServing: { calories: 170, proteinG: 13, carbsG: 26, fatG: 2 }, source: "INDB" as const },
  { slug: "paneer-bhurji", name: "Paneer Bhurji", servingGrams: 100, macrosPerServing: { calories: 265, proteinG: 16, carbsG: 6, fatG: 20 }, source: "INDB" as const },
  { slug: "egg-bhurji", name: "Egg Bhurji (2 eggs)", servingGrams: 120, macrosPerServing: { calories: 200, proteinG: 13, carbsG: 3, fatG: 15 }, source: "INDB" as const },
  { slug: "steamed-rice", name: "Steamed Rice", servingGrams: 150, macrosPerServing: { calories: 195, proteinG: 4, carbsG: 43, fatG: 0.5 }, source: "IFCT2017" as const },
  { slug: "soya-chunk-curry", name: "Soya Chunk Curry", servingGrams: 150, macrosPerServing: { calories: 210, proteinG: 22, carbsG: 18, fatG: 5 }, source: "INDB" as const },
  { slug: "boiled-egg", name: "Boiled Egg", servingGrams: 50, macrosPerServing: { calories: 78, proteinG: 6.3, carbsG: 0.6, fatG: 5.3 }, source: "IFCT2017" as const },
];

export async function seedIndianDishes(): Promise<number> {
  let count = 0;
  for (const dish of DISHES) {
    await IndianDish.findOneAndUpdate({ slug: dish.slug }, dish, { upsert: true });
    count += 1;
  }
  return count;
}
