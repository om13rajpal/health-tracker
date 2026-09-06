import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { loadEnv } from "./env.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.MONGO_URI = "mongodb://localhost:27017/test";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "password";
  process.env.MCP_ACCESS_TOKEN = "token";
  process.env.GEMINI_API_KEY = "test-gemini-key";
});

afterAll(() => {
  process.env = originalEnv;
});

describe("loadEnv", () => {
  it("returns the parsed env when everything is set", () => {
    const env = loadEnv();
    expect(env.mongoUri).toBe("mongodb://localhost:27017/test");
    expect(env.sessionSecret).toHaveLength(32);
  });

  it("throws on a missing required var", () => {
    delete process.env.MONGO_URI;
    expect(() => loadEnv()).toThrow(/MONGO_URI/);
  });

  it("rejects a SESSION_SECRET under 32 characters at boot, not on first login", () => {
    process.env.SESSION_SECRET = "a".repeat(31);
    expect(() => loadEnv()).toThrow(/at least 32 characters/);
  });
});
