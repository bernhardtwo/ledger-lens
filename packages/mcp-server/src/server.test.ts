/**
 * Locks down that the deterministic `decimal` on every money field reaches the agent
 * and is never silently dropped (ADR-0007 §2a) — the failure that would re-expose the
 * agent to doing minor-unit → decimal math itself. Three angles: the **declared**
 * output schema (`tools/list`), the `ToolMoneySchema` parse (the Zod-3 intersection
 * that attaches it), and the value a real `summarize_account` call emits on the wire.
 * A future zod / MCP SDK / zod-to-json-schema change that breaks any of these turns
 * red here. In-memory transport, `@ledger-lens/db` mocked: no Docker, runs under `pnpm check`.
 */
import type { Database } from "@ledger-lens/db";
import { getAccountById, listTransactionAmounts } from "@ledger-lens/db";
import { money, moneyDtoToDecimalString, toMoneyDTO } from "@ledger-lens/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { ToolMoneySchema } from "./schemas.js";
import { createMcpServer } from "./server.js";

vi.mock("@ledger-lens/db", () => ({
  getAccountById: vi.fn(),
  listAccounts: vi.fn(),
  listTransactions: vi.fn(),
  listTransactionAmounts: vi.fn(),
}));

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
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

describe("ToolMoney `decimal` survives to the agent", () => {
  it("ToolMoneySchema keeps `decimal` through a parse (the Zod-3 intersection)", () => {
    const dto = toMoneyDTO(money(750402n, "USD"));
    const parsed = ToolMoneySchema.parse({ ...dto, decimal: moneyDtoToDecimalString(dto) });
    expect(parsed.decimal).toBe("7504.02");
    expect(parsed).toMatchObject({ amount: "750402", currency: "USD", minorUnitExponent: 2 });
  });

  it("a real summarize_account call emits `decimal` on the wire", async () => {
    vi.mocked(getAccountById).mockResolvedValue({
      id: ACCOUNT_ID,
      name: "Checking",
      institution: "Test Bank",
      currencyCode: "USD",
      kind: "bank",
    });
    vi.mocked(listTransactionAmounts).mockResolvedValue([
      { category: "income", direction: "credit", amountMinor: 250000n },
      { category: "groceries", direction: "debit", amountMinor: 3000n },
    ]);

    const server = createMcpServer({} as Database);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "decimal-wire-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const result = await client.callTool({
        name: "summarize_account",
        arguments: { accountId: ACCOUNT_ID },
      });
      const summary = result.structuredContent as
        | {
            totalIn: { decimal: string };
            totalOut: { decimal: string };
            net: { amount: { decimal: string } };
          }
        | undefined;
      expect(summary?.totalIn.decimal).toBe("2500.00");
      expect(summary?.totalOut.decimal).toBe("30.00");
      expect(summary?.net.amount.decimal).toBe("2470.00");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
