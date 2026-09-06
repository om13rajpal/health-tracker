// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import LogSleepPage from "./page";
import * as outbox from "../../../lib/outbox";

afterEach(() => {
  cleanup();
});

describe("LogSleepPage error handling", () => {
  it("shows the required-fields error instead of a stale 'Saved.' message", async () => {
    render(<LogSleepPage />);

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Bed time and wake time are both required.")).toBeInTheDocument());
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("clears a prior 'Saved.' message when a later submission fails to save", async () => {
    vi.spyOn(outbox, "queueForSync")
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("QuotaExceededError"));

    render(<LogSleepPage />);

    fireEvent.change(screen.getByLabelText("Bed time"), { target: { value: "2026-09-05T22:00" } });
    fireEvent.change(screen.getByLabelText("Wake time"), { target: { value: "2026-09-06T06:00" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText(/Couldn't save on this device/)).toBeInTheDocument());
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("does not crash when a datetime field is cleared after being filled in", async () => {
    render(<LogSleepPage />);

    const bedTimeInput = screen.getByLabelText("Bed time");
    fireEvent.change(bedTimeInput, { target: { value: "2026-09-05T22:00" } });
    fireEvent.change(bedTimeInput, { target: { value: "" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Bed time and wake time are both required.")).toBeInTheDocument());
    expect(screen.getByText("Save")).toBeInTheDocument();
  });
});
