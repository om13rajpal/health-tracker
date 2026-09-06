import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFoodSearch } from "./useFoodSearch";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useFoodSearch", () => {
  it("does not fetch for an empty query", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useFoodSearch(""), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches dishes matching a non-empty query", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([{ slug: "dal-tadka", name: "Dal Tadka" }])))
    );
    const { result } = renderHook(() => useFoodSearch("dal"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0].slug).toBe("dal-tadka");
  });

  it("reports an error on a 401 instead of handing back the error body as results", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }))
    );
    function noRetryWrapper({ children }: { children: React.ReactNode }) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useFoodSearch("dal"), { wrapper: noRetryWrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
