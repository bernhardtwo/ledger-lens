/**
 * Response envelope for `GET /accounts/:accountId/transactions`, lifted out of
 * `apps/api` so the NestJS response-validation pipe and the web client import the
 * **identical** Zod symbol (single source of truth; see spec 0006). Built from the
 * domain schemas — no money or query logic lives here.
 */
import { z } from "zod";
import { CategorySchema } from "../domain/category.js";
import { TransactionListItemSchema } from "../domain/transaction.js";

/** List item enriched with its category (Phase 2): `null` until categorized. */
export const TransactionListItemResponseSchema = TransactionListItemSchema.extend({
  category: CategorySchema.nullable(),
});
export type TransactionListItemResponse = z.infer<typeof TransactionListItemResponseSchema>;

/** Response: the list projection (no `rawRow`) + an opaque next-page cursor. */
export const TransactionsPageResponseSchema = z.object({
  items: z.array(TransactionListItemResponseSchema),
  nextCursor: z.string().nullable(),
});
export type TransactionsPageResponse = z.infer<typeof TransactionsPageResponseSchema>;
