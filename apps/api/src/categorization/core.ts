/**
 * Categorization core (see spec 0002, ADR-0006). Pure and **SDK-free**: it owns
 * batching, prompt-item assembly, Zod validation, index->id reconciliation, and
 * the per-item fallback. The only I/O is the injected `CategorizationClient`.
 *
 * Trust model: the LLM's output is never trusted. A successful-but-invalid output
 * degrades **per item** to `uncategorized` and never throws. Only a transport
 * error (the client throwing) propagates — and is handled one batch at a time so a
 * failed batch leaves its rows for a later retry rather than failing the run.
 */
import {
  type Category,
  CategorySchema,
  UNCATEGORIZED,
  money,
  toDecimalString,
} from "@ledger-lens/shared";
import { z } from "zod";
import type {
  CategorizableTransaction,
  CategorizationClient,
  CategorizationItem,
  CategorizationRun,
} from "./types.js";

/** Default transactions per API call (see ADR-0006). */
export const DEFAULT_BATCH_SIZE = 50;

/**
 * Lenient envelope schema: validate only the *structure*. `category` is a plain
 * string here and is checked against the closed taxonomy per item, so one bad
 * label degrades that item rather than failing the batch.
 */
const ToolOutputSchema = z.object({
  categorizations: z.array(z.object({ index: z.number().int(), category: z.string() })),
});

function toItem(transaction: CategorizableTransaction, index: number): CategorizationItem {
  return {
    index,
    description: transaction.description,
    direction: transaction.direction,
    // Reuse the shared money formatter — context only, no arithmetic here.
    amount: toDecimalString(money(transaction.amountMinor, transaction.currencyCode)),
    currency: transaction.currencyCode,
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

/**
 * Categorize one batch. Returns a category for **every** input transaction
 * (falling back to `uncategorized`). Throws only if the client throws.
 */
export async function categorizeBatch(
  batch: readonly CategorizableTransaction[],
  client: CategorizationClient,
): Promise<Map<string, Category>> {
  const items = batch.map((transaction, position) => toItem(transaction, position + 1));
  const indexToId = new Map(batch.map((transaction, position) => [position + 1, transaction.id]));

  const raw = await client.categorize(items); // may throw (transport)

  // Default everything to the fallback; valid model output overrides per item.
  const result = new Map<string, Category>(
    batch.map((transaction) => [transaction.id, UNCATEGORIZED]),
  );

  const parsed = ToolOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return result; // unparseable envelope -> the whole batch stays uncategorized
  }
  for (const entry of parsed.data.categorizations) {
    const id = indexToId.get(entry.index);
    if (id === undefined) {
      continue; // hallucinated / out-of-range index -> ignored (stays uncategorized)
    }
    const category = CategorySchema.safeParse(entry.category);
    if (category.success) {
      result.set(id, category.data); // off-taxonomy labels are left as uncategorized
    }
  }
  return result;
}

/**
 * Categorize all transactions in sequential batches. A batch that fails at the
 * transport layer is recorded in `failedIds` (its rows stay `NULL`, resumable on
 * the next run); every other transaction gets an assignment.
 */
export async function categorizeTransactions(
  transactions: readonly CategorizableTransaction[],
  client: CategorizationClient,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<CategorizationRun> {
  const assignments = new Map<string, Category>();
  const failedIds: string[] = [];

  for (const batch of chunk(transactions, Math.max(1, Math.trunc(batchSize)))) {
    try {
      for (const [id, category] of await categorizeBatch(batch, client)) {
        assignments.set(id, category);
      }
    } catch {
      for (const transaction of batch) {
        failedIds.push(transaction.id);
      }
    }
  }

  return { assignments, failedIds };
}
