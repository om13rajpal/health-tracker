"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./apiFetch";

export type Exercise = {
  slug: string;
  name: string;
  muscleGroups: string[];
  equipment: string[];
  images: string[];
  homeEquivalentSlug?: string;
};

export function useExercises() {
  return useQuery({
    queryKey: ["exercises"],
    queryFn: async () => {
      const res = await apiFetch("/api/exercises");
      if (!res.ok) throw new Error(`Failed to load exercises: ${res.status}`);
      return (await res.json()) as Exercise[];
    },
    // A seeded catalogue that only changes on a redeploy. Refetching it with
    // the rest of the dashboard would be pure waste, so it is fetched once per
    // session and served from cache after that.
    staleTime: Infinity,
  });
}
