import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Web React component tests run as their OWN project (root = apps/web) so React and
 * the JSX runtime resolve from this package's node_modules, with a jsdom DOM. Pure
 * `.ts` web tests (api client, money-format) run in the root node project instead.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["**/*.{test,spec}.tsx"],
  },
});
