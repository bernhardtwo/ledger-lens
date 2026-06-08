/**
 * MCP server wiring (see ADR-0007, spec 0003). Registers the read-only tools on an
 * `McpServer`. This is the only transport-/SDK-coupled file; the handlers and the
 * money folds it calls are plain functions. Each tool's output is parsed through
 * its Zod schema before returning — an output trust boundary, and the source of
 * the tool's declared output JSON schema.
 */
import type { Database } from "@ledger-lens/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AccountIdInputSchema,
  AccountSummaryOutputSchema,
  GetAccountOutputSchema,
  ListAccountsOutputSchema,
  ListTransactionsInputSchema,
  ListTransactionsOutputSchema,
  RangeInputSchema,
  SpendingByCategoryOutputSchema,
} from "./schemas.js";
import {
  handleGetAccount,
  handleListAccounts,
  handleListTransactions,
  handleSpendingByCategory,
  handleSummarizeAccount,
} from "./tools.js";

/** Wrap a validated structured output as an MCP tool result (JSON text + structured). */
function jsonResult(structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/** Build the domain MCP server, with every read-only tool registered over `db`. */
export function createMcpServer(db: Database): McpServer {
  const server = new McpServer({ name: "ledgerlens-domain", version: "0.0.0" });

  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description: "List all financial accounts (id, name, institution, currency, kind).",
      outputSchema: ListAccountsOutputSchema.shape,
    },
    async () => jsonResult(ListAccountsOutputSchema.parse(await handleListAccounts(db))),
  );

  server.registerTool(
    "get_account",
    {
      title: "Get account",
      description: "Get one account by id. Returns an error if the account does not exist.",
      inputSchema: AccountIdInputSchema.shape,
      outputSchema: GetAccountOutputSchema.shape,
    },
    async (args) => jsonResult(GetAccountOutputSchema.parse(await handleGetAccount(db, args))),
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description:
        "List an account's transactions with optional date-range, category and direction filters; keyset-paginated. Excludes the raw source row.",
      inputSchema: ListTransactionsInputSchema.shape,
      outputSchema: ListTransactionsOutputSchema.shape,
    },
    async (args) =>
      jsonResult(ListTransactionsOutputSchema.parse(await handleListTransactions(db, args))),
  );

  server.registerTool(
    "summarize_spending_by_category",
    {
      title: "Summarize spending by category",
      description:
        "Total spending (debits) per category for an account over an optional date range.",
      inputSchema: RangeInputSchema.shape,
      outputSchema: SpendingByCategoryOutputSchema.shape,
    },
    async (args) =>
      jsonResult(SpendingByCategoryOutputSchema.parse(await handleSpendingByCategory(db, args))),
  );

  server.registerTool(
    "summarize_account",
    {
      title: "Summarize account cash flow",
      description:
        "Total inflow, outflow and net cash flow for an account over an optional date range.",
      inputSchema: RangeInputSchema.shape,
      outputSchema: AccountSummaryOutputSchema.shape,
    },
    async (args) =>
      jsonResult(AccountSummaryOutputSchema.parse(await handleSummarizeAccount(db, args))),
  );

  return server;
}
