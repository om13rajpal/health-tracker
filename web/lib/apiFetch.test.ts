import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch } from "./apiFetch";

describe("apiFetch", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  });

  it("always sets credentials to include", async () => {
    await apiFetch("/api/auth/whoami");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:4000/api/auth/whoami",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("preserves caller-supplied init options", async () => {
    await apiFetch("/api/workouts", { method: "POST", body: "{}" });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:4000/api/workouts",
      expect.objectContaining({ method: "POST", body: "{}", credentials: "include" })
    );
  });
});
