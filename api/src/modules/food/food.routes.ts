import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { searchIndianDishes, lookupPackagedFoodByBarcode } from "./food.service.js";

export const foodRouter = Router();

foodRouter.get("/dishes", requireAuth, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const dishes = await searchIndianDishes(q);
  res.json(dishes);
});

foodRouter.get("/packaged/:barcode", requireAuth, async (req, res) => {
  const barcode = Array.isArray(req.params.barcode) ? req.params.barcode[0] : req.params.barcode;
  const product = await lookupPackagedFoodByBarcode(barcode);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(product);
});
