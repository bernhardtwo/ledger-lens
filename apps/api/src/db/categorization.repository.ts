/**
 * Categorization persistence (see spec 0002, ADR-0006) — data access only.
 *  - read an account's UNCATEGORIZED (`category IS NULL`) transactions;
 *  - apply assigned categories idempotently.
 * Kept separate from `repository.ts` so that file stays ingestion-focused.
 */
import type { Category, CurrencyCode, Direction } from "@ledger-lens/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { transactions } from "./schema.js";

/** The fields the categorizer needs as context (no money math — display only). */
export interface UncategorizedTransaction {
  readonly id: string;
  readonly description: string;
  readonly direction: Direction;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
}

/** A category assignment to persist. */
export interface CategoryAssignment {
  readonly id: string;
  readonly category: Category;
}

/**
 * Fetch an account's not-yet-categorized transactions (`category IS NULL`), in a
 * stable order so batching is deterministic across runs.
 */
export async function listUncategorizedTransactions(
  db: Database,
  accountId: string,
): Promise<UncategorizedTransaction[]> {
  return db
    .select({
      id: transactions.id,
      description: transactions.description,
      direction: transactions.direction,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.category)))
    .orderBy(asc(transactions.transactionDate), asc(transactions.id));
}

/**
 * Persist category assignments. Each `UPDATE` guards with `category IS NULL`, so a
 * row already categorized by a concurrent run is never overwritten (idempotent).
 * Returns the ids **actually updated** — so the caller counts what was persisted
 * this run, not merely what it intended (a concurrently-categorized row is skipped
 * and excluded from the result).
 */
export async function applyCategorizations(
  db: Database,
  assignments: readonly CategoryAssignment[],
  model: string,
  categorizedAt: Date,
): Promise<string[]> {
  if (assignments.length === 0) {
    return [];
  }
  return db.transaction(async (tx) => {
    const updatedIds: string[] = [];
    for (const assignment of assignments) {
      const rows = await tx
        .update(transactions)
        .set({ category: assignment.category, categoryModel: model, categorizedAt })
        .where(and(eq(transactions.id, assignment.id), isNull(transactions.category)))
        .returning({ id: transactions.id });
      if (rows[0] !== undefined) {
        updatedIds.push(rows[0].id);
      }
    }
    return updatedIds;
  });
}
