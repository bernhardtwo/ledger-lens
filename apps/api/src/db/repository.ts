/**
 * Persistence repository (see spec 0001) — pure data-access functions, no NestJS.
 *
 * Two responsibilities:
 *  - `persistIngestion`: write a statement + its transactions in one DB
 *    transaction, honoring the idempotency rule (insert, skip duplicates, and
 *    never leave an empty statement behind).
 *  - `listTransactions` / `getTransactionById`: read back, with the `raw_row`
 *    excluded from the default/list projection and present only on an audit fetch.
 */
import { type CurrencyCode, type Direction, IsoDateSchema } from "@ledger-lens/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { TransactionDraft } from "../ingestion/types.js";
import type { Database } from "./client.js";
import { statements, transactions } from "./schema.js";

/** Columns returned by the default/list projection — deliberately **without** `raw_row`. */
const listProjection = {
  id: transactions.id,
  accountId: transactions.accountId,
  statementId: transactions.statementId,
  transactionDate: transactions.transactionDate,
  postedDate: transactions.postedDate,
  description: transactions.description,
  direction: transactions.direction,
  amountMinor: transactions.amountMinor,
  currencyCode: transactions.currencyCode,
  fingerprint: transactions.fingerprint,
} as const;

/** A transaction as returned by the list projection (no `rawRow`). */
export interface TransactionListRow {
  readonly id: string;
  readonly accountId: string;
  readonly statementId: string;
  readonly transactionDate: string;
  readonly postedDate: string | null;
  readonly description: string;
  readonly direction: Direction;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
  readonly fingerprint: string;
}

export interface PersistIngestionInput {
  readonly accountId: string;
  readonly sourceFilename: string;
  readonly profileId: string;
  /** Accepted drafts from the ingestion core (already fingerprinted). */
  readonly accepted: readonly TransactionDraft[];
}

export interface PersistIngestionResult {
  /** The statement id, or `null` when no statement was kept (zero new transactions). */
  readonly statementId: string | null;
  /** Transactions actually inserted (new). */
  readonly inserted: number;
  /** Accepted drafts skipped as duplicates of already-persisted transactions. */
  readonly skipped: number;
}

/**
 * Persist one ingestion result. Runs in a single transaction:
 *  1. insert the statement (`rowCount` = accepted rows in the file),
 *  2. bulk-insert transactions with `ON CONFLICT (account_id, fingerprint) DO NOTHING`,
 *  3. if zero rows were inserted, delete the just-created statement so we never
 *     accumulate an empty/orphan statement (e.g. a re-import or header-only file).
 */
export async function persistIngestion(
  db: Database,
  input: PersistIngestionInput,
): Promise<PersistIngestionResult> {
  return db.transaction(async (tx) => {
    const insertedStatement = await tx
      .insert(statements)
      .values({
        accountId: input.accountId,
        sourceFilename: input.sourceFilename,
        profileId: input.profileId,
        rowCount: input.accepted.length,
      })
      .returning({ id: statements.id });

    const statement = insertedStatement[0];
    if (statement === undefined) {
      throw new Error("statement insert returned no row");
    }
    const statementId = statement.id;

    const insertedRows =
      input.accepted.length === 0
        ? []
        : await tx
            .insert(transactions)
            .values(
              input.accepted.map((draft) => ({
                accountId: input.accountId,
                statementId,
                transactionDate: draft.transactionDate,
                postedDate: draft.postedDate,
                description: draft.description,
                direction: draft.direction,
                amountMinor: draft.amount.amount,
                currencyCode: draft.amount.currency,
                fingerprint: draft.fingerprint,
                rawRow: draft.rawRow,
              })),
            )
            .onConflictDoNothing({
              target: [transactions.accountId, transactions.fingerprint],
            })
            .returning({ id: transactions.id });

    const inserted = insertedRows.length;
    const skipped = input.accepted.length - inserted;

    if (inserted === 0) {
      // No new transactions reference this statement -> drop it (no orphan).
      await tx.delete(statements).where(eq(statements.id, statementId));
      return { statementId: null, inserted: 0, skipped };
    }

    return { statementId, inserted, skipped };
  });
}

export interface ListTransactionsParams {
  readonly accountId: string;
  /** Page size (clamped to 1..200). */
  readonly limit: number;
  /** Opaque keyset cursor from a previous page, or `null`/absent for the first page. */
  readonly cursor?: string | null;
}

export interface TransactionsPage {
  readonly items: readonly TransactionListRow[];
  /** Cursor for the next page, or `null` when the last page has been reached. */
  readonly nextCursor: string | null;
}

/**
 * List an account's transactions with stable keyset pagination ordered by
 * `(transaction_date, id)`. Returns the list projection (no `raw_row`) and a
 * `nextCursor` when more rows remain.
 */
export async function listTransactions(
  db: Database,
  params: ListTransactionsParams,
): Promise<TransactionsPage> {
  const limit = Math.min(Math.max(Math.trunc(params.limit), 1), 200);
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;

  const accountFilter = eq(transactions.accountId, params.accountId);
  // Row-value keyset seek: `(transaction_date, id) > (cursor)`. The single
  // tuple comparison is the idiomatic form that drives the
  // (account_id, transaction_date, id) index directly. Casts are safe because
  // `decodeCursor` validates the halves as a date and a uuid.
  const where = cursor
    ? and(
        accountFilter,
        sql`(${transactions.transactionDate}, ${transactions.id}) > (${cursor.date}::date, ${cursor.id}::uuid)`,
      )
    : accountFilter;

  const rows = await db
    .select(listProjection)
    .from(transactions)
    .where(where)
    .orderBy(asc(transactions.transactionDate), asc(transactions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encodeCursor(last.transactionDate, last.id) : null;
  return { items, nextCursor };
}

/**
 * Fetch a single transaction including its `raw_row` — the audit/replay path.
 * **Account-scoped**: a transaction is only returned for its owning account, so a
 * known/guessed id can never expose another account's raw row. Returns `null`
 * when no such transaction exists for that account.
 */
export async function getTransactionById(db: Database, accountId: string, id: string) {
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.accountId, accountId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Encode a `(transaction_date, id)` keyset position as an opaque cursor. */
function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`, "utf8").toString("base64url");
}

const CursorIdSchema = z.string().uuid();

/**
 * Decode an opaque cursor back into its validated `(date, id)` keyset position.
 * The halves are validated as a calendar date and a uuid (reusing the shared
 * `IsoDateSchema`) so a hostile/garbage cursor yields a controlled error here,
 * never a raw `invalid input syntax` driver error from the SQL casts downstream.
 */
function decodeCursor(cursor: string): { date: string; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = raw.indexOf("|");
  if (separator === -1) {
    throw new Error("malformed pagination cursor");
  }
  const date = IsoDateSchema.safeParse(raw.slice(0, separator));
  const id = CursorIdSchema.safeParse(raw.slice(separator + 1));
  if (!date.success || !id.success) {
    throw new Error("malformed pagination cursor");
  }
  return { date: date.data, id: id.data };
}
