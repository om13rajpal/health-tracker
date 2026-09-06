// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { AuthGuard } from "./AuthGuard";

const pushMock = vi.fn();
let pathname = "/train";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathname,
}));

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  vi.restoreAllMocks();
});

describe("AuthGuard", () => {
  it("does not check auth or redirect on /login", async () => {
    pathname = "/login";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));

    render(
      <AuthGuard>
        <p>login form</p>
      </AuthGuard>
    );

    expect(screen.getByText("login form")).toBeInTheDocument();
    await waitFor(() => expect(pushMock).not.toHaveBeenCalled());
  });

  it("redirects to /login on a protected path when whoami confirms the session is gone", async () => {
    pathname = "/train";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));

    render(
      <AuthGuard>
        <p>protected content</p>
      </AuthGuard>
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });

  it("does not redirect on a protected path when whoami succeeds", async () => {
    pathname = "/train";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ loggedIn: true }), { status: 200 }))
    );

    render(
      <AuthGuard>
        <p>protected content</p>
      </AuthGuard>
    );

    await waitFor(() => expect(screen.getByText("protected content")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not redirect when the server is unreachable — that is not evidence the session is invalid", async () => {
    // A cold-started free-tier API, a network blip, or a mid-deploy restart
    // all throw the same way a real 401 never does. Treating them like a
    // logout would defeat the persisted query cache, which exists precisely
    // to show last-known data while the server is unavailable.
    pathname = "/train";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(
      <AuthGuard>
        <p>protected content</p>
      </AuthGuard>
    );

    await waitFor(() => expect(screen.getByText("protected content")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not redirect on a 5xx — an unwell server is not an invalid session", async () => {
    pathname = "/train";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 502 })));

    render(
      <AuthGuard>
        <p>protected content</p>
      </AuthGuard>
    );

    await waitFor(() => expect(screen.getByText("protected content")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });
});
