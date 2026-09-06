import { Router } from "express";
import { z } from "zod";
import { FoodEntryInputSchema, MealSlotSchema } from "@health-tracker/shared";
import { requireAuth } from "../../lib/session.js";
import { logFoodEntry, getDailyMacroSummary, listFoodEntriesForDate } from "./nutrition.service.js";
import { createGeminiClient } from "./gemini-client.js";
import { parseNaturalLanguageFood, parsePhotoFood } from "./nutrition-parsing.service.js";

export const nutritionRouter = Router();

const ParseTextBodySchema = z.object({
  text: z.string().trim().min(1),
  mealSlot: MealSlotSchema,
});

const ParsePhotoBodySchema = z.object({
  image: z.string().trim().min(1),
  mealSlot: MealSlotSchema,
});

nutritionRouter.post("/entries", requireAuth, async (req, res) => {
  const parsed = FoodEntryInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const entry = await logFoodEntry(parsed.data);
  res.status(201).json({ entry });
});

nutritionRouter.get("/summary/:date", requireAuth, async (req, res) => {
  const date = Array.isArray(req.params.date) ? req.params.date[0] : req.params.date;
  const summary = await getDailyMacroSummary(date);
  res.json(summary);
});

nutritionRouter.get("/entries/:date", requireAuth, async (req, res) => {
  const date = Array.isArray(req.params.date) ? req.params.date[0] : req.params.date;
  const entries = await listFoodEntriesForDate(date);
  res.json(entries);
});

nutritionRouter.post("/parse", requireAuth, async (req, res) => {
  // Reuse the same MealSlotSchema the rest of nutrition already validates
  // against (FoodEntryInputSchema), rather than a loose truthy check that
  // would accept an invalid mealSlot like "midnight-snack" and only fail
  // later, confusingly, when the frontend tries to save the confirmed draft.
  const parsed = ParseTextBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? "");
  try {
    const draft = await parseNaturalLanguageFood(parsed.data.text, parsed.data.mealSlot, geminiClient);
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: "Failed to parse food text", details: (err as Error).message });
  }
});

nutritionRouter.post("/parse-photo", requireAuth, async (req, res) => {
  const parsed = ParsePhotoBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? "");
  try {
    const draft = await parsePhotoFood(parsed.data.image, parsed.data.mealSlot, geminiClient);
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: "Failed to parse food photo", details: (err as Error).message });
  }
});
