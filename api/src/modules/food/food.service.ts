import { IndianDish } from "../../models/IndianDish.js";
import { PackagedFood } from "../../models/PackagedFood.js";

const MAX_DISH_RESULTS = 20;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function searchIndianDishes(query: string) {
  return IndianDish.find({ name: { $regex: escapeRegExp(query), $options: "i" } }).limit(MAX_DISH_RESULTS).lean();
}

export async function lookupPackagedFoodByBarcode(barcode: string) {
  return PackagedFood.findOne({ barcode }).lean();
}
