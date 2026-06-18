/**
 * Exercises the impure faithfulness half (ADR-0009 §5): `collectAllowedFigures`
 * re-runs the agent's recorded tool calls and reconstructs the money figures it
 * legitimately saw. `@ledger-lens/db` is mocked, so the REAL handlers + the real
 * decimal-collection run against canned rows — the lightest faithful boundary, no
 * Docker (the live eval uses testcontainers; a unit test does not need it).
 */
import type { Database } from "@ledger-lens/db";
import { getAccountById, listTransactionAmounts } from "@ledger-lens/db";
import type { AgentToolCall } from "@ledger-lens/evals";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectAllowedFigures } from "./faithfulness.js";

// Partial mock: @ledger-lens/evals pulls in real `SEED_ACCOUNTS` etc., so keep the
// module intact and stub only the read queries the handlers run.
vi.mock("@ledger-lens/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ledger-lens/db")>()),
  getAccountById: vi.fn(),
  listAccounts: vi.fn(),
  listTransactions: vi.fn(),
  listTransactionAmounts: vi.fn(),
}));

const SCOPED = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const db = {} as Database;

function seedAccountWithFlow(): void {
  vi.mocked(getAccountById).mockResolvedValue({
    id: SCOPED,
    name: "Checking",
    institution: "Test Bank",
    currencyCode: "USD",
    kind: "bank",
  });
  vi.mocked(listTransactionAmounts).mockResolvedValue([
    { category: "income", direction: "credit", amountMinor: 250000n },
    { category: "groceries", direction: "debit", amountMinor: 3000n },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectAllowedFigures — re-executing the agent's tool calls", () => {
  it("reconstructs exactly the figures a known transcript produced", async () => {
    seedAccountWithFlow();
    const transcript: AgentToolCall[] = [
      { tool: "summarize_account", input: { accountId: SCOPED } },
    ];

    const figures = await collectAllowedFigures(db, transcript, SCOPED);

    // totalIn 2500.00, totalOut 30.00, net (credit) 2470.00 — the only figures the agent saw.
    expect(new Set(figures)).toEqual(new Set(["2500.00", "30.00", "2470.00"]));
    // A figure the tools never produced is absent, so the scorer can flag it as fabricated.
    expect(figures).not.toContain("9999.99");
  });

  it("forces the scoped accountId, ignoring the id recorded in the call (injection)", async () => {
    seedAccountWithFlow();
    const transcript: AgentToolCall[] = [
      { tool: "summarize_account", input: { accountId: FOREIGN } },
    ];

    await collectAllowedFigures(db, transcript, SCOPED);

    expect(vi.mocked(getAccountById)).toHaveBeenCalledWith(db, SCOPED);
    expect(vi.mocked(listTransactionAmounts)).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ accountId: SCOPED }),
    );
  });

  it("adds no figure for a tool call that errors", async () => {
    vi.mocked(getAccountById).mockResolvedValue(null); // unknown account -> the handler throws
    const transcript: AgentToolCall[] = [
      { tool: "summarize_account", input: { accountId: SCOPED } },
    ];

    expect(await collectAllowedFigures(db, transcript, SCOPED)).toEqual([]);
  });
});
