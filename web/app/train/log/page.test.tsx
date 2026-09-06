// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LogWorkoutPage from "./page";
import * as outbox from "../../../lib/outbox";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("LogWorkoutPage validation", () => {
  it("refuses to queue a session where no set has any reps", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: [], equipment: [], images: [] }]))));
    const queueSpy = vi.spyOn(outbox, "queueForSync").mockResolvedValue(1);

    const { container } = renderWithClient(<LogWorkoutPage />);
    const scoped = within(container);
    await waitFor(() => scoped.getByText("Incline Push-Up"));
    fireEvent.change(scoped.getByRole("combobox"), { target: { value: "incline-pushup" } });

    // Sets start at reps: 0 — saving now would feed the progression engine a
    // failed working set.
    fireEvent.click(scoped.getByText("Save session"));

    await waitFor(() => expect(scoped.getByText(/at least one set with reps/i)).toBeInTheDocument());
    expect(queueSpy).not.toHaveBeenCalled();
    expect(scoped.queryByText(/will sync automatically/)).not.toBeInTheDocument();
  });

  it("queues the session once a set has reps", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: [], equipment: [], images: [] }]))));
    const queueSpy = vi.spyOn(outbox, "queueForSync").mockResolvedValue(1);

    const { container } = renderWithClient(<LogWorkoutPage />);
    const scoped = within(container);
    await waitFor(() => scoped.getByText("Incline Push-Up"));
    fireEvent.change(scoped.getByRole("combobox"), { target: { value: "incline-pushup" } });
    fireEvent.change(scoped.getByPlaceholderText("Reps"), { target: { value: "10" } });

    fireEvent.click(scoped.getByText("Save session"));

    await waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(1));
    expect(scoped.getByText(/will sync automatically/)).toBeInTheDocument();
  });
});

describe("LogWorkoutPage error handling", () => {
  it("shows an error message instead of a false 'Saved' when queueForSync throws", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: [], equipment: [], images: [] }]))));
    vi.spyOn(outbox, "queueForSync").mockRejectedValue(new Error("QuotaExceededError"));

    renderWithClient(<LogWorkoutPage />);
    await waitFor(() => screen.getByText("Incline Push-Up"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "incline-pushup" } });
    fireEvent.change(screen.getByPlaceholderText("Reps"), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Save session"));

    await waitFor(() => expect(screen.getByText(/Couldn't save this session/)).toBeInTheDocument());
    expect(screen.queryByText(/will sync automatically/)).not.toBeInTheDocument();
  });

  it("clears a prior 'Saved' message when a later submission fails", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: [], equipment: [], images: [] }]))));
    vi.spyOn(outbox, "queueForSync")
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("QuotaExceededError"));

    const { container } = renderWithClient(<LogWorkoutPage />);
    const scoped = within(container);
    await waitFor(() => scoped.getByText("Incline Push-Up"));
    fireEvent.change(scoped.getByRole("combobox"), { target: { value: "incline-pushup" } });
    fireEvent.change(scoped.getByPlaceholderText("Reps"), { target: { value: "10" } });

    fireEvent.click(scoped.getByText("Save session"));
    await waitFor(() => expect(scoped.getByText(/will sync automatically/)).toBeInTheDocument());

    fireEvent.click(scoped.getByText("Save session"));

    await waitFor(() => expect(scoped.getByText(/Couldn't save this session/)).toBeInTheDocument());
    expect(scoped.queryByText(/will sync automatically/)).not.toBeInTheDocument();
  });
});
