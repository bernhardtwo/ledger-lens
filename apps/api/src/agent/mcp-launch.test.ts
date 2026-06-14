import { describe, expect, it } from "vitest";
import { launchForEntry } from "./mcp-launch.js";

/**
 * Pins both spawn branches (ADR-0012). The dev branch must stay byte-identical to the
 * pre-Phase-7 spawn (`node --import <tsx> <entry>`); the prod branch must launch plain
 * node under `--conditions=ledgerlens-dist` with NO tsx. The real `mcpServerLaunch()`
 * delegates here with the resolved entry, so testing by extension covers both.
 */
describe("launchForEntry", () => {
  it("dev (.ts entry): spawns via the tsx loader, args unchanged", () => {
    const { command, args } = launchForEntry("/repo/packages/mcp-server/src/main.ts");
    expect(command).toBe(process.execPath);
    expect(args[0]).toBe("--import");
    expect(args[1]).toMatch(/tsx/);
    expect(args[2]).toBe("/repo/packages/mcp-server/src/main.ts");
  });

  it("prod (.js entry): spawns plain node under --conditions=ledgerlens-dist, no tsx", () => {
    const { command, args } = launchForEntry(
      "/app/node_modules/@ledger-lens/mcp-server/dist/main.js",
    );
    expect(command).toBe(process.execPath);
    expect(args).toEqual([
      "--conditions=ledgerlens-dist",
      "/app/node_modules/@ledger-lens/mcp-server/dist/main.js",
    ]);
  });
});
