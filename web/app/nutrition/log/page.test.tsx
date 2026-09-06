import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LogFoodPage from "./page";
import * as outbox from "../../../lib/outbox";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function parseResponse(items: unknown[], needsAddedFatPrompt = false) {
  return new Response(JSON.stringify({ items, needsAddedFatPrompt }));
}

const DAL = { source: "indian_dish", refId: "dal-tadka", name: "Dal Tadka", macros: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 } };
const ROTI = { source: "indian_dish", refId: "roti", name: "Roti", macros: { calories: 120, proteinG: 3, carbsG: 22, fatG: 2 } };

describe("LogFoodPage confirmDraft partial failure", () => {
  it("keeps the draft open and marks only the failed item when one of two queue writes fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(parseResponse([DAL, ROTI])));
    vi.spyOn(outbox, "queueForSync")
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("QuotaExceededError"));

    renderWithClient(<LogFoodPage />);
    fireEvent.change(screen.getByPlaceholderText("2 roti aur dal chawal"), { target: { value: "dal aur roti" } });
    fireEvent.click(screen.getByText("Parse"));
    await waitFor(() => screen.getByText("Review before saving"));

    fireEvent.click(screen.getByText("Confirm and save"));

    await waitFor(() => expect(screen.getByText(/couldn't save on this device/i)).toBeInTheDocument());
    expect(screen.getByText(/queued for sync/)).toBeInTheDocument();
    expect(screen.getByText("Review before saving")).toBeInTheDocument(); // draft stays open
    expect(screen.getByText("Retry failed items")).toBeInTheDocument();
  });

  it("queues every item through the outbox rather than posting directly", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(parseResponse([DAL, ROTI]));
    vi.stubGlobal("fetch", fetchMock);
    const queueSpy = vi.spyOn(outbox, "queueForSync").mockResolvedValue(1);

    renderWithClient(<LogFoodPage />);
    fireEvent.change(screen.getByPlaceholderText("2 roti aur dal chawal"), { target: { value: "dal aur roti" } });
    fireEvent.click(screen.getByText("Parse"));
    await waitFor(() => screen.getByText("Review before saving"));

    fireEvent.click(screen.getByText("Confirm and save"));

    await waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(2));
    expect(queueSpy.mock.calls.every(([type]) => type === "nutrition")).toBe(true);
    // Only the parse call went over the network — no direct entries POST.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/nutrition/parse");
    // Every item queued, so the draft is cleared.
    await waitFor(() => expect(screen.queryByText("Review before saving")).not.toBeInTheDocument());
  });
});

describe("LogFoodPage stale draft after a failed re-parse", () => {
  it("drops the previous draft when a new parse fails, leaving nothing savable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(parseResponse([DAL]))
        .mockResolvedValueOnce(new Response("{}", { status: 502 }))
    );
    const queueSpy = vi.spyOn(outbox, "queueForSync").mockResolvedValue(1);

    renderWithClient(<LogFoodPage />);
    const textarea = screen.getByPlaceholderText("2 roti aur dal chawal");

    fireEvent.change(textarea, { target: { value: "dal tadka" } });
    fireEvent.click(screen.getByText("Parse"));
    await waitFor(() => screen.getByText("Review before saving"));

    fireEvent.change(textarea, { target: { value: "something else entirely" } });
    fireEvent.click(screen.getByText("Parse"));

    await waitFor(() => expect(screen.getByText(/Couldn't understand that/)).toBeInTheDocument());
    expect(screen.queryByText("Review before saving")).not.toBeInTheDocument();
    expect(screen.queryByText("Dal Tadka", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm and save")).not.toBeInTheDocument();
    expect(queueSpy).not.toHaveBeenCalled();
  });
});

describe("LogFoodPage addedFatGrams staleness", () => {
  it("does not leak a previous draft's addedFatGrams into a draft that doesn't need it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(parseResponse([DAL], true))
      .mockResolvedValueOnce(parseResponse([ROTI], false));
    vi.stubGlobal("fetch", fetchMock);
    const queueSpy = vi.spyOn(outbox, "queueForSync").mockResolvedValue(1);

    renderWithClient(<LogFoodPage />);
    const textarea = screen.getByPlaceholderText("2 roti aur dal chawal");

    // Draft A: parse, enter added-fat grams, confirm and save.
    fireEvent.change(textarea, { target: { value: "dal tadka with ghee" } });
    fireEvent.click(screen.getByText("Parse"));
    await waitFor(() => screen.getByText("Review before saving"));
    fireEvent.change(screen.getByLabelText(/Added oil\/ghee/), { target: { value: "15" } });
    fireEvent.click(screen.getByText("Confirm and save"));
    await waitFor(() => expect(screen.queryByText("Review before saving")).not.toBeInTheDocument());

    // Draft B: parse a new, unrelated draft that does not need the added-fat prompt.
    fireEvent.change(textarea, { target: { value: "roti" } });
    fireEvent.click(screen.getByText("Parse"));
    await waitFor(() => screen.getByText("Review before saving"));
    expect(screen.queryByLabelText(/Added oil\/ghee/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm and save"));
    await waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(2));

    const draftBPayload = queueSpy.mock.calls[1][1] as { addedFatGrams?: number };
    expect(draftBPayload.addedFatGrams).toBeUndefined();
  });

  it("attaches the meal's addedFatGrams to exactly one item of a multi-item draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(parseResponse([DAL, ROTI], true)));
    const queueSpy = vi.spyOn(outbox, "queueForSync").mockResolvedValue(1);

    renderWithClient(<LogFoodPage />);
    fireEvent.change(screen.getByPlaceholderText("2 roti aur dal chawal"), { target: { value: "dal aur roti with ghee" } });
    fireEvent.click(screen.getByText("Parse"));
    await waitFor(() => screen.getByText("Review before saving"));
    fireEvent.change(screen.getByLabelText(/Added oil\/ghee/), { target: { value: "15" } });
    fireEvent.click(screen.getByText("Confirm and save"));

    await waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(2));
    const fatValues = queueSpy.mock.calls.map(([, payload]) => (payload as { addedFatGrams?: number }).addedFatGrams);
    // 15g of ghee once, not once per dish.
    expect(fatValues).toEqual([15, undefined]);
  });
});
