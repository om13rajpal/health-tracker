import { z } from "zod";
import { IndianDish } from "../../models/IndianDish.js";
import type { GeminiClient } from "./gemini-client.js";

export type { GeminiClient };

const GeminiFoodItemSchema = z.object({
  matchedSlug: z.string().nullable(),
  isGravyOrCurry: z.boolean(),
  estimatedName: z.string().optional(),
  estimatedMacros: z
    .object({ calories: z.number(), proteinG: z.number(), carbsG: z.number(), fatG: z.number() })
    .optional(),
});

const GeminiFoodResponseSchema = z.object({
  items: z.array(GeminiFoodItemSchema),
});

type GeminiFoodItem = z.infer<typeof GeminiFoodItemSchema>;

export type ParsedFoodItem = {
  source: "indian_dish" | "packaged_food" | "llm_estimate";
  refId?: string;
  name: string;
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
};

export type ParsedFoodDraft = {
  items: ParsedFoodItem[];
  needsAddedFatPrompt: boolean;
};

function buildTextPrompt(text: string, mealSlot: string): string {
  return `You are a nutrition-logging assistant for an Indian home-cooking context. The user logged this ${mealSlot}: "${text}".

Identify each distinct food item mentioned. For each item, respond with a JSON object matching this exact shape (respond with ONLY the JSON, no other text):
{
  "items": [
    {
      "matchedSlug": "<a plausible database slug for a common Indian dish, e.g. 'dal-tadka', 'roti', 'rajma' — lowercase, hyphenated, or null if this doesn't match a well-known dish>",
      "isGravyOrCurry": <true if this is a gravy/curry-type dish where added oil/ghee is likely invisible and significant, false otherwise>,
      "estimatedName": "<a human-readable name, only needed if matchedSlug is null>",
      "estimatedMacros": { "calories": <number>, "proteinG": <number>, "carbsG": <number>, "fatG": <number> } (only needed if matchedSlug is null)
    }
  ]
}`;
}

async function resolveMatchedItems(items: GeminiFoodItem[]): Promise<ParsedFoodDraft> {
  const resolved: ParsedFoodItem[] = [];
  let needsAddedFatPrompt = false;

  for (const item of items) {
    if (item.isGravyOrCurry) needsAddedFatPrompt = true;

    if (item.matchedSlug) {
      const dish = await IndianDish.findOne({ slug: item.matchedSlug });
      if (dish) {
        resolved.push({ source: "indian_dish", refId: dish.slug, name: dish.name, macros: dish.macrosPerServing });
        continue;
      }
    }

    resolved.push({
      source: "llm_estimate",
      name: item.estimatedName ?? "Unknown item",
      macros: item.estimatedMacros ?? { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    });
  }

  return { items: resolved, needsAddedFatPrompt };
}

function parseAndValidate(raw: string): GeminiFoodItem[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned an invalid response: not valid JSON");
  }

  const validated = GeminiFoodResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error("Gemini returned an invalid response: unexpected shape");
  }

  return validated.data.items;
}

export async function parseNaturalLanguageFood(
  text: string,
  mealSlot: string,
  geminiClient: GeminiClient
): Promise<ParsedFoodDraft> {
  const raw = await geminiClient.generateContent(buildTextPrompt(text, mealSlot));
  const items = parseAndValidate(raw);
  return resolveMatchedItems(items);
}

function buildPhotoPrompt(mealSlot: string): string {
  return `You are a nutrition-logging assistant for an Indian home-cooking context. Identify the food item(s) in this photo, logged as ${mealSlot}. Respond with ONLY JSON in this exact shape:
{
  "items": [
    {
      "matchedSlug": "<a plausible database slug for a common Indian dish, lowercase hyphenated, or null>",
      "isGravyOrCurry": <true if this is a gravy/curry where added oil/ghee is likely invisible in the photo, false otherwise>,
      "estimatedName": "<human-readable name, only if matchedSlug is null>",
      "estimatedMacros": { "calories": <number>, "proteinG": <number>, "carbsG": <number>, "fatG": <number> } (only if matchedSlug is null)
    }
  ]
}`;
}

export async function parsePhotoFood(
  imageBase64: string,
  mealSlot: string,
  geminiClient: GeminiClient
): Promise<ParsedFoodDraft> {
  const raw = await geminiClient.generateContentWithImage(buildPhotoPrompt(mealSlot), imageBase64);
  const items = parseAndValidate(raw);
  return resolveMatchedItems(items);
}
