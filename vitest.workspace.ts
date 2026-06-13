import { defineWorkspace } from "vitest/config";

/**
 * Three projects, selected per npm script (so a workspace file can coexist with the
 * Docker-bound integration suite — `--config` alone is overridden by a workspace):
 *  - `node`        — packages + apps/api + the web app's pure `.ts` tests;
 *  - `web`         — the jsdom/React project for web component `.tsx` tests;
 *  - `integration` — `*.itest.ts` (Docker/testcontainers), run on its own.
 * `pnpm test` runs node + web (Docker-free); `pnpm test:integration` runs integration.
 */
export default defineWorkspace([
  "./vitest.config.ts",
  "./apps/web/vitest.config.ts",
  "./vitest.integration.config.ts",
]);
