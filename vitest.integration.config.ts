import { defineConfig } from "vitest/config";

/**
 * Integration tests (`*.itest.ts`) — they spin up a disposable Postgres via
 * testcontainers (and, for the HTTP e2e, a NestJS app), so they need Docker and
 * are kept OUT of the default `vitest.config.ts` (and therefore out of
 * `pnpm check` / `pnpm test`). Run them with `pnpm test:integration`.
 *
 * `esbuild.tsconfigRaw` enables legacy decorators for the whole run so esbuild can
 * transform NestJS decorators. DI is token-based (`@Inject`), so NO decorator
 * metadata is needed — esbuild suffices, no SWC. `reflect-metadata` is loaded
 * before any decorated class is evaluated.
 */
export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    name: "integration",
    include: ["apps/**/*.itest.ts", "packages/**/*.itest.ts"],
    // `reflect-metadata` is imported as the first line of the HTTP e2e suite,
    // before any NestJS-decorated class is evaluated.
    // Pulling the Postgres image + starting the container on first run is slow.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
