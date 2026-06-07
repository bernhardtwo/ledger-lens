import { CategorySchema, TransactionListItemSchema, money, toMoneyDTO } from "@ledger-lens/shared";
import { z } from "zod";
import type { TransactionListRow } from "../../db/repository.js";

/** List item enriched with its category (Phase 2): `null` until categorized. */
export const TransactionListItemResponseSchema = TransactionListItemSchema.extend({
  category: CategorySchema.nullable(),
});

/** Query of `GET /accounts/:accountId/transactions`. `limit` is coerced + clamped. */
export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // An empty `?cursor=` means "first page", not a malformed cursor.
  cursor: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
});

export type ListQuery = z.infer<typeof ListQuerySchema>;

/** Response: the list projection (no `rawRow`) + an opaque next-page cursor. */
export const TransactionsPageResponseSchema = z.object({
  items: z.array(TransactionListItemResponseSchema),
  nextCursor: z.string().nullable(),
});

export type TransactionsPageResponse = z.infer<typeof TransactionsPageResponseSchema>;

/**
 * Map a DB list row to the canonical transaction DTO, reconstructing `amount` as a
 * `MoneyDTO` (string minor units) via the shared `money`/`toMoneyDTO` — no money
 * logic is reimplemented here, and no `bigint` reaches JSON. Returns the schema's
 * INPUT shape; the controller validates it through `TransactionListItemSchema`.
 */
export function toTransactionListItem(
  row: TransactionListRow,
): z.input<typeof TransactionListItemResponseSchema> {
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
