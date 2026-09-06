// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useExercises } from "./useExercises";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useExercises", () => {
  it("fetches and returns the exercise list", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: [], equipment: [], images: [] }]))
      )
    );

    const { result } = renderHook(() => useExercises(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.[0].slug).toBe("incline-pushup");
  });

  it("reports an error on a 401 instead of handing back the error body as a list", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }))
    );
    function noRetryWrapper({ children }: { children: React.ReactNode }) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useExercises(), { wrapper: noRetryWrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
