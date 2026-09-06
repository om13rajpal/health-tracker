// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Page from "./page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("today page", () => {
  it("renders the page heading", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
    renderWithClient(<Page />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Today");
  });

  it("shows a distinct error state rather than an empty record when the reads fail", async () => {
    // A failed fetch must never render as a silent zero-day ledger — that
    // looks identical to a genuinely empty record and would be trusted.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    renderWithClient(<Page />);

    // Each failed read announces itself separately (the record, the coach
    // note), so assert on the set rather than on there being exactly one.
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/didn't load/i);
  });
});
