// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOutboxSync } from "./useOutbox";
import * as outbox from "./outbox";

vi.mock("./outbox.js", () => ({
  syncOutbox: vi.fn().mockResolvedValue({ synced: 0, failed: 0, invalid: 0 }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness() {
  useOutboxSync();
  return null;
}

// The hook invalidates queries after a successful sync, so it now needs a
// client in scope the same way it does in the app.
function renderWithClient(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  );
}

describe("useOutboxSync", () => {
  it("removes the online listener on unmount, leaving no listener registered", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderWithClient();
    const [, handler] = addSpy.mock.calls.find(([type]) => type === "online")!;

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("online", handler);
  });

  it("refreshes the dashboards once queued writes actually reach the server", async () => {
    // Without this, a session logged in the gym stays invisible on every
    // dashboard until some unrelated refetch happens to run.
    vi.mocked(outbox.syncOutbox).mockResolvedValueOnce({ synced: 2, failed: 0, invalid: 0 });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    renderWithClient(client);

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("does not invalidate when nothing synced", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    renderWithClient(client);

    await waitFor(() => expect(vi.mocked(outbox.syncOutbox)).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalled();
  });
});
