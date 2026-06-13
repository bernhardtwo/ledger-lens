import type { NextConfig } from "next";

// The browser only ever calls same-origin Next; `/api/*` is proxied to the API
// (server-side env, never `NEXT_PUBLIC_`), so the API needs no CORS change.
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
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
