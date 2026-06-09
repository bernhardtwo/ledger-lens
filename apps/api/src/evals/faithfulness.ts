/**
 * Faithfulness support (see ADR-0009 §5): reconstruct the set of figures the agent
 * legitimately saw by **re-executing its actual tool calls** against the seeded DB.
 * The tools are deterministic, so re-execution reproduces exactly what the agent
 * was shown; any money figure in the answer outside this set (∪ the ground truth)
 * is a fabrication. This is the impure half of faithfulness — the pure scorer lives
 * in `@ledger-lens/evals`.
 */
import type { Database } from "@ledger-lens/db";
import type { AgentToolCall } from "@ledger-lens/evals";
import { renderDecimal } from "@ledger-lens/evals";
import {
  AccountIdInputSchema,
  ListTransactionsInputSchema,
  RangeInputSchema,
  handleGetAccount,
  handleListTransactions,
  handleSpendingByCategory,
  handleSummarizeAccount,
} from "@ledger-lens/mcp-server";
import { MoneySchema } from "@ledger-lens/shared";

async function runHandler(db: Database, tool: string, input: unknown): Promise<unknown> {
  switch (tool) {
    case "get_account":
      return handleGetAccount(db, AccountIdInputSchema.parse(input));
    case "list_transactions":
      return handleListTransactions(db, ListTransactionsInputSchema.parse(input));
    case "summarize_spending_by_category":
      return handleSpendingByCategory(db, RangeInputSchema.parse(input));
    case "summarize_account":
      return handleSummarizeAccount(db, RangeInputSchema.parse(input));
    default:
      // list_accounts / unknown — denied in production, never reaches the DB here.
      return null;
  }
}

/** Walk a tool output, collecting the decimal form of every `MoneyDTO` it contains. */
function collectMoneyDecimals(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMoneyDecimals(item, out);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    const asMoney = MoneySchema.safeParse(value);
    if (asMoney.success) {
      out.add(renderDecimal(asMoney.data));
      return; // a Money is a leaf — don't recurse into its fields.
    }
    for (const nested of Object.values(value)) {
      collectMoneyDecimals(nested, out);
    }
  }
}

/**
 * The decimal figures the agent legitimately saw for one question. Each call is
 * re-run with the **scoped** accountId forced in (mirroring the production
 * `canUseTool` injection — the recorded input carries the model's accountId, which
 * may differ). A call that throws contributed no figure (the agent saw an error).
 */
export async function collectAllowedFigures(
  db: Database,
  toolCalls: readonly AgentToolCall[],
  scopedAccountId: string,
): Promise<string[]> {
  const figures = new Set<string>();
  for (const call of toolCalls) {
    const scopedInput = { ...call.input, accountId: scopedAccountId };
    try {
      const output = await runHandler(db, call.tool, scopedInput);
      collectMoneyDecimals(output, figures);
    } catch {
      // The real tool would have errored too — no legitimate figure to add.
    }
  }
  return [...figures];
}
