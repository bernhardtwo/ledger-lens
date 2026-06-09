/**
 * Zod input/output schemas for the MCP tools (see spec 0003). Reuses the shared
 * domain schemas (Account, Money, Category, …) so the tool contract validates
 * against the same source of truth as persistence. Money is always a `MoneyDTO`.
 */
import {
  AccountSchema,
  CategorySchema,
  CurrencyCodeSchema,
  DirectionSchema,
  IsoDateSchema,
  MoneySchema,
  TransactionListItemSchema,
} from "@ledger-lens/shared";
import { z } from "zod";

// ---- inputs ----

export const AccountIdInputSchema = z.object({ accountId: z.string().uuid() });

export const RangeInputSchema = z.object({
  accountId: z.string().uuid(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
});

export const ListTransactionsInputSchema = z.object({
  accountId: z.string().uuid(),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
  category: CategorySchema.optional(),
  direction: DirectionSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

// Handler input types use `z.input` (pre-brand): date fields are plain `string`.
// The MCP SDK passes already-parsed args (branded `IsoDate`, assignable to
// `string`), and direct callers/tests can pass plain string literals.
export type AccountIdInput = z.input<typeof AccountIdInputSchema>;
export type RangeInput = z.input<typeof RangeInputSchema>;
export type ListTransactionsInput = z.input<typeof ListTransactionsInputSchema>;

// ---- outputs ----

/**
 * Money as the **agent** sees it: the canonical minor-unit `MoneyDTO` (kept for
 * fidelity) PLUS a `decimal` — the exact human amount rendered deterministically by
 * the shared `toDecimalString` (e.g. `"7504.02"`). The agent relays `decimal`
 * verbatim and never converts minor units itself, so decimal placement stays
 * deterministic code, not LLM math (ADR-0004, ADR-0007 §money-on-the-wire). Only
 * the MCP tool surface carries it; `MoneyDTO`/ADR-0005 are unchanged, and the HTTP
 * API (not an LLM surface) still returns the plain `MoneyDTO`.
 */
export const ToolMoneySchema = z.intersection(
  MoneySchema,
  z.object({
    decimal: z.string().regex(/^\d+(\.\d+)?$/, "decimal must be a non-negative decimal"),
  }),
);

/** A list item enriched with its category (Phase 2); money carries the `decimal`. */
export const CategorizedTransactionSchema = TransactionListItemSchema.extend({
  category: CategorySchema.nullable(),
  amount: ToolMoneySchema,
});

export const ListAccountsOutputSchema = z.object({ accounts: z.array(AccountSchema) });

export const GetAccountOutputSchema = AccountSchema;

export const ListTransactionsOutputSchema = z.object({
  items: z.array(CategorizedTransactionSchema),
  nextCursor: z.string().nullable(),
});

const CategorySpendingSchema = z.object({
  category: CategorySchema,
  total: ToolMoneySchema,
  transactionCount: z.number().int().nonnegative(),
});

export const SpendingByCategoryOutputSchema = z.object({
  accountId: z.string().uuid(),
  currency: CurrencyCodeSchema,
  dateFrom: IsoDateSchema.nullable(),
  dateTo: IsoDateSchema.nullable(),
  categories: z.array(CategorySpendingSchema),
  total: ToolMoneySchema,
});

export const AccountSummaryOutputSchema = z.object({
  accountId: z.string().uuid(),
  currency: CurrencyCodeSchema,
  dateFrom: IsoDateSchema.nullable(),
  dateTo: IsoDateSchema.nullable(),
  totalIn: ToolMoneySchema,
  totalOut: ToolMoneySchema,
  net: z.object({ direction: DirectionSchema, amount: ToolMoneySchema }),
  transactionCount: z.number().int().nonnegative(),
});
