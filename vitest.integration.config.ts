import { defineConfig } from "vitest/config";

/**
 * Integration tests (`*.itest.ts`) — they spin up a disposable Postgres via
 * testcontainers, so they need Docker and are kept OUT of the default
 * `vitest.config.ts` (and therefore out of `pnpm check` / `pnpm test`). Run them
 * with `pnpm test:integration`. The default suite stays fast and Docker-free.
 */
export default defineConfig({
  test: {
    include: ["apps/**/*.itest.ts", "packages/**/*.itest.ts"],
    // Pulling the Postgres image + starting the container on first run is slow.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
