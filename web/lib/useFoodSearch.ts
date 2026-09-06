"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./apiFetch";

export type DishResult = {
  slug: string;
  name: string;
  servingGrams: number;
  macrosPerServing: { calories: number; proteinG: number; carbsG: number; fatG: number };
  source: string;
};

export function useFoodSearch(query: string) {
  return useQuery({
    queryKey: ["food-search", query],
    queryFn: async () => {
      const res = await apiFetch(`/api/food/dishes?q=${encodeURIComponent(query)}`);
      // A 401 body is {error: "..."}, not an array — casting it and calling
      // .map() on it would throw during render with no error boundary to catch it.
      if (!res.ok) throw new Error(`Food search failed: ${res.status}`);
      return (await res.json()) as DishResult[];
    },
    enabled: query.length > 0,
  });
}
