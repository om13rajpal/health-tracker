"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./apiFetch";

export type RecipeSuggestion = {
  slug: string;
  name: string;
  prepMinutes: number;
  equipment: string[];
  tags: string[];
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
};

export function useRecipeSuggestions(mealSlot: string, remainingProteinG: number, remainingCalories: number) {
  return useQuery({
    queryKey: ["recipe-suggestions", mealSlot, remainingProteinG, remainingCalories],
    queryFn: async () => {
      const params = new URLSearchParams({
        mealSlot,
        remainingProteinG: String(remainingProteinG),
        remainingCalories: String(remainingCalories),
      });
      const res = await apiFetch(`/api/recipes/suggestions?${params}`);
      if (!res.ok) throw new Error(`Failed to load recipe suggestions: ${res.status}`);
      return (await res.json()) as RecipeSuggestion[];
    },
    // A zero-calorie budget is not a question worth asking the server.
    enabled: remainingCalories > 0,
  });
}
