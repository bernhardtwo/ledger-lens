/**
 * MCP tool handlers (see spec 0003) — plain `(db, input) -> output` functions,
 * decoupled from the MCP transport so they are called directly in tests. They
 * reuse the `@ledger-lens/db` read queries and the shared `Money` aggregation;
 * no LLM, no transport, no money/date logic of their own. `raw_row` is never
 * returned. Unknown accounts throw (surfaced as a tool error by the server).
 */
import {
  type Database,
  type TransactionListRow,
  getAccountById,
  listAccounts,
  listTransactionAmounts,
  listTransactions,
} from "@ledger-lens/db";
import type { Account, AccountKind, CurrencyCode } from "@ledger-lens/shared";
import { money, toMoneyDTO } from "@ledger-lens/shared";
import type { z } from "zod";
import { summarizeAccountFlow, summarizeSpendingByCategory } from "./aggregation.js";
import type {
  AccountIdInput,
  AccountSummaryOutputSchema,
  CategorizedTransactionSchema,
  ListTransactionsInput,
  ListTransactionsOutputSchema,
  RangeInput,
  SpendingByCategoryOutputSchema,
} from "./schemas.js";

interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly currencyCode: CurrencyCode;
  readonly kind: AccountKind;
}

function toAccountDto(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    currency: row.currencyCode,
    kind: row.kind,
  };
}

function toListItem(row: TransactionListRow): z.input<typeof CategorizedTransactionSchema> {
  return {
    id: row.id,
    accountId: row.accountId,
    statementId: row.statementId,
    transactionDate: row.transactionDate,
    postedDate: row.postedDate,
    description: row.description,
    direction: row.direction,
    amount: toMoneyDTO(money(row.amountMinor, row.currencyCode)),
    fingerprint: row.fingerprint,
    category: row.category,
  };
}

function accountNotFound(accountId: string): never {
  throw new Error(`account ${accountId} not found`);
}

/** `list_accounts` — every account, ordered by name. */
export async function handleListAccounts(db: Database): Promise<{ accounts: Account[] }> {
  const rows = await listAccounts(db);
  return { accounts: rows.map(toAccountDto) };
}

/** `get_account` — one account, or a tool error when it does not exist. */
export async function handleGetAccount(db: Database, input: AccountIdInput): Promise<Account> {
  const row = await getAccountById(db, input.accountId);
  if (row === null) {
    accountNotFound(input.accountId);
  }
  return toAccountDto(row);
}

/** `list_transactions` — filtered, keyset-paginated list (no `raw_row`). */
export async function handleListTransactions(
  db: Database,
  input: ListTransactionsInput,
): Promise<z.input<typeof ListTransactionsOutputSchema>> {
  if ((await getAccountById(db, input.accountId)) === null) {
    accountNotFound(input.accountId);
  }
  const page = await listTransactions(db, {
    accountId: input.accountId,
    limit: input.limit ?? 50,
    cursor: input.cursor ?? null,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    category: input.category,
    direction: input.direction,
  });
  return { items: page.items.map(toListItem), nextCursor: page.nextCursor };
}

/** `summarize_spending_by_category` — debit totals per category over a range. */
export async function handleSpendingByCategory(
  db: Database,
  input: RangeInput,
): Promise<z.input<typeof SpendingByCategoryOutputSchema>> {
  const account = await getAccountById(db, input.accountId);
  if (account === null) {
    accountNotFound(input.accountId);
  }
  const rows = await listTransactionAmounts(db, {
    accountId: input.accountId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });
  const summary = summarizeSpendingByCategory(rows, account.currencyCode);
  return {
    accountId: input.accountId,
    currency: account.currencyCode,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    categories: [...summary.categories],
    total: summary.total,
  };
}

/** `summarize_account` — net cash flow (totals + net) over a range. */
export async function handleSummarizeAccount(
  db: Database,
  input: RangeInput,
): Promise<z.input<typeof AccountSummaryOutputSchema>> {
  const account = await getAccountById(db, input.accountId);
  if (account === null) {
    accountNotFound(input.accountId);
  }
  const rows = await listTransactionAmounts(db, {
    accountId: input.accountId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });
  const summary = summarizeAccountFlow(rows, account.currencyCode);
  return {
    accountId: input.accountId,
    currency: account.currencyCode,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    totalIn: summary.totalIn,
    totalOut: summary.totalOut,
    net: summary.net,
    transactionCount: summary.transactionCount,
  };
}
