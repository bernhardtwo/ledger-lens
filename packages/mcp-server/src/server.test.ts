/**
 * Locks down the **declared** tool output schema the agent is actually shown — not
 * just the runtime value the handler tests assert. Every money field must carry the
 * deterministic `decimal` (ADR-0007 §2a), so a future zod / MCP SDK /
 * zod-to-json-schema change can't silently drop it and re-expose the agent to doing
 * minor-unit → decimal math itself. Uses an in-memory transport: no DB, no Docker
 * (`tools/list` never queries `db`), so it runs under `pnpm check`.
 */
import type { Database } from "@ledger-lens/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./server.js";

const MONEY_TOOLS = ["summarize_account", "summarize_spending_by_category", "list_transactions"];

describe("createMcpServer declared output schemas", () => {
  it("expose a deterministic `decimal` on every money field", async () => {
    const server = createMcpServer({} as Database);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "schema-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of MONEY_TOOLS) {
        const tool = byName.get(name);
        expect(tool, name).toBeDefined();
        // `decimal` appears only as the property name on money objects, so a
        // substring check is a sound (and SDK-version-robust) regression guard.
        expect(JSON.stringify(tool?.outputSchema ?? null), name).toContain("decimal");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
