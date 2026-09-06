import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { suggestRecipes } from "./recipes.service.js";

export const recipesRouter = Router();

recipesRouter.get("/suggestions", requireAuth, async (req, res) => {
  const remainingCalories = Number(req.query.remainingCalories ?? 0);
  // A garbage/missing query value coerces to NaN, and Mongo's $lte against
  // NaN is not a validation error — it just silently matches nothing (or
  // behaves unpredictably depending on driver version). Reject it explicitly
  // instead of returning a confusing empty list with no explanation.
  if (!Number.isFinite(remainingCalories) || remainingCalories < 0) {
    res.status(400).json({ error: "remainingCalories must be a non-negative number" });
    return;
  }
  const suggestions = await suggestRecipes(remainingCalories);
  res.json(suggestions);
});
