import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The browser only ever calls same-origin Next; `/api/*` is proxied to the API
// (server-side env, never `NEXT_PUBLIC_`), so the API needs no CORS change.
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (`.next/standalone/.../server.js`) for the
  // minimal container image (ADR-0012); shared is traced/transpiled into it.
  output: "standalone",
  // Trace from the monorepo root so the standalone bundle resolves workspace deps
  // regardless of build cwd (ADR-0012).
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  // @ledger-lens/shared ships raw TS — Next must transpile it for the bundle.
  transpilePackages: ["@ledger-lens/shared"],
  // Biome lints the repo; don't run ESLint during `next build`.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBaseUrl}/:path*` }];
  },
  webpack: (config) => {
    // NOTE: webpack-only. Do NOT enable Turbopack (`--turbopack`) without porting
    // this to `experimental.turbo.resolveAlias` — shared's `.js`→`.ts` resolution
    // depends on this hook.
    // @ledger-lens/shared uses NodeNext-style `.js` import specifiers that resolve
    // to `.ts` sources; teach webpack to follow them when transpiling the package.
    const resolve = config.resolve as { extensionAlias?: Record<string, string[]> };
    resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ...resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;
