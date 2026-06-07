/**
 * Shared shapes for the deterministic ingestion core (see spec 0001).
 * Kept dependency-light: these are plain interfaces over the canonical domain
 * types from `@ledger-lens/shared`.
 */
import type { Direction, IsoDate, Money } from "@ledger-lens/shared";

/** A fully-parsed, validated row, before a fingerprint or persistence id is attached. */
export interface NormalizedRow {
  readonly transactionDate: IsoDate;
  readonly postedDate: IsoDate | null;
  readonly description: string;
  readonly direction: Direction;
  readonly amount: Money;
  readonly rawRow: Readonly<Record<string, string>>;
}

/**
 * A transaction ready to persist: a normalized row plus its dedupe `fingerprint`
 * and owning `accountId`. No DB-assigned `id`/`statementId` yet (those land with
 * persistence in a later chunk).
 */
export interface TransactionDraft extends NormalizedRow {
  readonly accountId: string;
  readonly fingerprint: string;
}

/** A row that could not be ingested: its 1-based data-row index (header excluded) + reason. */
export interface RejectedRow {
  readonly row: number;
  readonly reason: string;
}

/** Outcome of ingesting one CSV file. */
export interface IngestResult {
  readonly profileId: string;
  readonly accepted: readonly TransactionDraft[];
  readonly rejected: readonly RejectedRow[];
}
