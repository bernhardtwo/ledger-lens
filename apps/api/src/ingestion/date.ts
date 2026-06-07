/**
 * Deterministic date parsing (see spec 0001, step 3).
 *
 * The profile declares the field order via `DateFormat`; we never guess locale.
 * After reordering to `YYYY-MM-DD`, the shared `isoDate` validates that it is a
 * real calendar date, so "13/45/2026" is a row rejection — not a silent pass.
 */
import { type IsoDate, isoDate } from "@ledger-lens/shared";
import { RowRejection } from "./errors.js";
import type { DateFormat } from "./profiles/index.js";

const PATTERNS: Record<DateFormat, RegExp> = {
  "MM/DD/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
  "DD/MM/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
  "YYYY-MM-DD": /^(\d{4})-(\d{2})-(\d{2})$/,
};

/** Parse a source date string to a canonical `IsoDate` using the declared format. */
export function parseDate(raw: string, format: DateFormat): IsoDate {
  const value = raw.trim();
  const match = PATTERNS[format].exec(value);
  if (match === null) {
    throw new RowRejection(`invalid date "${raw}" for format ${format}`);
  }
  try {
    return isoDate(reorder(format, match));
  } catch {
    throw new RowRejection(`invalid date "${raw}" for format ${format}`);
  }
}

/** Reorder the matched groups into an ISO `YYYY-MM-DD` string. */
function reorder(format: DateFormat, match: RegExpExecArray): string {
  // Groups 1..3 are guaranteed present by the pattern that just matched.
  const g1 = match[1] as string;
  const g2 = match[2] as string;
  const g3 = match[3] as string;
  switch (format) {
    case "MM/DD/YYYY":
      return `${g3}-${g1}-${g2}`;
    case "DD/MM/YYYY":
      return `${g3}-${g2}-${g1}`;
    case "YYYY-MM-DD":
      return `${g1}-${g2}-${g3}`;
  }
}
