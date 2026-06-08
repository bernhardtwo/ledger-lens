/**
 * How to launch `@ledger-lens/mcp-server` as a stdio subprocess (ADR-0008). Both
 * the tsx loader and the entrypoint are resolved to **absolute** paths so the
 * command works regardless of the spawning process's cwd — the Agent SDK's stdio
 * MCP config has no `cwd` option, and pnpm does not hoist `tsx` to the repo root.
 *
 * tsx is the dev runtime (no build step yet); Phase 7's build will launch compiled
 * JS with plain `node`. The production adapter and the full-loop test share this so
 * they spawn the server identically.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export interface McpLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export function mcpServerLaunch(): McpLaunch {
  // tsx's `.` export is the loader the `--import tsx` shorthand uses; resolve it
  // to an absolute file URL so node doesn't have to find `tsx` from the cwd.
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const entry = require.resolve("@ledger-lens/mcp-server/stdio");
  return { command: process.execPath, args: ["--import", tsxLoader, entry] };
}
