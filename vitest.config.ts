import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Coverage gate is intentionally low in Phase 0 and ratchets up as
      // real domain + LLM code lands (see docs/adr).
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
});
