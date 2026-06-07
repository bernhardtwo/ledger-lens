/**
 * Dedupe fingerprint (see spec 0001, step 5).
 *
 * `fingerprint = sha256(accountId | transactionDate | amountMinor | direction |
 * normalizeDescription(description) | occurrenceOrdinal)`.
 *
 *  - `statementId` is deliberately excluded, so re-importing the same bytes
 *    reproduces identical fingerprints and the future unique `(account_id,
 *    fingerprint)` index skips the duplicates (idempotent re-import).
 *  - The **per-row occurrence ordinal** (the k-th accepted row sharing the same
 *    content tuple) lets two legitimately-identical rows — e.g. two $5 coffees on
 *    the same day — both survive with distinct keys.
 *  - The description component goes through the shared `normalizeDescription` (the
 *    same idempotent normalizer applied to the stored description), never a
 *    reimplementation.
 *
 * Fields are combined via `JSON.stringify` of a fixed-order tuple: the JSON string
 * quoting/escaping makes field boundaries unambiguous (no separator-injection risk
 * from spaces or punctuation in a description) without a magic delimiter byte.
 */
import { createHash } from "node:crypto";
import { normalizeDescription } from "@ledger-lens/shared";
import type { NormalizedRow } from "./types.js";

/** The content tuple shared by all rows that are "the same transaction" (sans ordinal). */
function contentKey(accountId: string, row: NormalizedRow): string {
  return JSON.stringify([
    accountId,
    row.transactionDate,
    row.amount.amount.toString(),
    row.direction,
    normalizeDescription(row.description),
  ]);
}

/** Fingerprint one row given its occurrence ordinal among same-content rows. */
export function fingerprintRow(
  accountId: string,
  row: NormalizedRow,
  occurrenceOrdinal: number,
): string {
  const payload = JSON.stringify([contentKey(accountId, row), occurrenceOrdinal]);
  return createHash("sha256").update(payload).digest("hex");
}

/** A row paired with its computed dedupe fingerprint. */
export interface FingerprintedRow {
  readonly row: NormalizedRow;
  readonly fingerprint: string;
}

/**
 * Fingerprint accepted rows in order, deriving each row's occurrence ordinal as
 * the number of earlier accepted rows sharing its content tuple. Returns each row
 * paired with its fingerprint (one per input row, same order) so callers never
 * have to index two parallel arrays.
 */
export function fingerprintAccepted(
  accountId: string,
  rows: readonly NormalizedRow[],
): FingerprintedRow[] {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const key = contentKey(accountId, row);
    const ordinal = counts.get(key) ?? 0;
    counts.set(key, ordinal + 1);
    return { row, fingerprint: fingerprintRow(accountId, row, ordinal) };
  });
}
