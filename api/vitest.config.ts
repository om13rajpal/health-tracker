import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    // This repo lives on an exFAT external drive; macOS shadows every file
    // with a "._<name>" AppleDouble resource-fork file, and vitest's default
    // include glob otherwise picks up "._*.test.ts" and fails to parse it.
    exclude: ["**/node_modules/**", "**/dist/**", "**/._*"],
  },
});
