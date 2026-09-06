import { describe, it, expect } from "vitest";
import { constantTimeEquals } from "./crypto.js";

describe("constantTimeEquals", () => {
  it("returns true for two identical non-empty strings", () => {
    expect(constantTimeEquals("correct-token", "correct-token")).toBe(true);
  });

  it("returns false for two different strings of the same length", () => {
    expect(constantTimeEquals("correct-token", "wrong-tokennn")).toBe(false);
  });

  it("returns false for two different-length strings", () => {
    expect(constantTimeEquals("short", "a-much-longer-string")).toBe(false);
  });

  it("returns false when either input is empty", () => {
    expect(constantTimeEquals("", "")).toBe(false);
    expect(constantTimeEquals("", "something")).toBe(false);
    expect(constantTimeEquals("something", "")).toBe(false);
  });
});
