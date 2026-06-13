import type { TransactionListRow } from "@ledger-lens/db";
import {
  TransactionListItemResponseSchema,
  type TransactionsPageResponse,
  TransactionsPageResponseSchema,
  money,
  toMoneyDTO,
} from "@ledger-lens/shared";
import { z } from "zod";

// The response envelopes now live in `@ledger-lens/shared` (spec 0006) so the
// client validates the identical schema; re-exported here so existing imports
// (controller, service) keep resolving unchanged.
export { TransactionListItemResponseSchema, TransactionsPageResponseSchema };
export type { TransactionsPageResponse };

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

/**
 * Map a DB list row to the canonical transaction DTO, reconstructing `amount` as a
 * `MoneyDTO` (string minor units) via the shared `money`/`toMoneyDTO` — no money
 * logic is reimplemented here, and no `bigint` reaches JSON. Returns the schema's
 * INPUT shape; the controller validates it through `TransactionListItemResponseSchema`.
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
