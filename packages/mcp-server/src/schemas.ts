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

/** A list item enriched with its category (Phase 2), matching the HTTP projection. */
export const CategorizedTransactionSchema = TransactionListItemSchema.extend({
  category: CategorySchema.nullable(),
});

export const ListAccountsOutputSchema = z.object({ accounts: z.array(AccountSchema) });

export const GetAccountOutputSchema = AccountSchema;

export const ListTransactionsOutputSchema = z.object({
  items: z.array(CategorizedTransactionSchema),
  nextCursor: z.string().nullable(),
});

const CategorySpendingSchema = z.object({
  category: CategorySchema,
  total: MoneySchema,
  transactionCount: z.number().int().nonnegative(),
});

export const SpendingByCategoryOutputSchema = z.object({
  accountId: z.string().uuid(),
  currency: CurrencyCodeSchema,
  dateFrom: IsoDateSchema.nullable(),
  dateTo: IsoDateSchema.nullable(),
  categories: z.array(CategorySpendingSchema),
  total: MoneySchema,
});

export const AccountSummaryOutputSchema = z.object({
  accountId: z.string().uuid(),
  currency: CurrencyCodeSchema,
  dateFrom: IsoDateSchema.nullable(),
  dateTo: IsoDateSchema.nullable(),
  totalIn: MoneySchema,
  totalOut: MoneySchema,
  net: z.object({ direction: DirectionSchema, amount: MoneySchema }),
  transactionCount: z.number().int().nonnegative(),
});
