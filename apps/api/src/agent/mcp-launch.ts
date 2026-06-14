/**
 * How to launch `@ledger-lens/mcp-server` as a stdio subprocess (ADR-0008). Both
 * the tsx loader and the entrypoint are resolved to **absolute** paths so the
 * command works regardless of the spawning process's cwd — the Agent SDK's stdio
 * MCP config has no `cwd` option, and pnpm does not hoist `tsx` to the repo root.
 *
 * In dev, tsx is the runtime; the compiled image (ADR-0012) launches the server's
 * built `dist/main.js` with plain `node` under `--conditions=ledgerlens-dist`. The
 * production adapter and the full-loop test share this so they spawn it identically.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export interface McpLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export function mcpServerLaunch(): McpLaunch {
  // Resolve the MCP server's stdio entry. Under the compiled image (ADR-0012) the
  // api process runs with `--conditions=ledgerlens-dist`, so this resolves to the
  // package's `dist/main.js`; in dev (no condition) it resolves to `src/main.ts`.
  return launchForEntry(require.resolve("@ledger-lens/mcp-server/stdio"));
}

/**
 * Build the spawn command for a resolved MCP stdio entry. Split out so both branches
 * are unit-testable without controlling process-level `--conditions`: the resolved
 * extension distinguishes the runtimes — `.js` (compiled, resolved under the dist
 * condition) vs `.ts` (dev). Exported for tests.
 */
export function launchForEntry(entry: string): McpLaunch {
  if (entry.endsWith(".js")) {
    // Compiled prod: launch with plain node (no tsx), passing the SAME condition to
    // the child so its own `@ledger-lens/*` imports also load compiled JS, not `.ts`.
    return { command: process.execPath, args: ["--conditions=ledgerlens-dist", entry] };
  }
  // Dev (spawn unchanged): tsx's `.` export is the loader the `--import tsx`
  // shorthand uses; resolve it to an absolute file URL so node doesn't have to find
  // `tsx` from the cwd.
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  return { command: process.execPath, args: ["--import", tsxLoader, entry] };
}
