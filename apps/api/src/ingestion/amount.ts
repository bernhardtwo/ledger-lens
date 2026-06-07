/**
 * Deterministic amount parsing (see spec 0001, step 3; ADR-0005).
 *
 * Turns a raw amount cell into a non-negative magnitude string + a sign, without
 * `parseFloat` (floats are unacceptable for money). Handles a leading sign,
 * optional parentheses-negative, grouping separators, currency symbols, and the
 * profile's decimal separator. The magnitude is handed to the shared
 * `fromDecimalString`, which does the exact minor-unit conversion.
 */
import { RowRejection } from "./errors.js";
import type { NumberFormat } from "./profiles/index.js";

export interface SignedDecimal {
  /** Canonical non-negative decimal string, e.g. "1234.50". Matches /^\d+(\.\d+)?$/. */
  readonly magnitude: string;
  /** -1 (money out), 1 (money in), or 0 (exactly zero). */
  readonly sign: -1 | 0 | 1;
}

/** Parse a raw amount cell. Throws `RowRejection` when it is not a recognizable number. */
export function parseSignedDecimal(raw: string, format: NumberFormat): SignedDecimal {
  let value = raw.trim();
  if (value === "") {
    throw new RowRejection("empty amount");
  }

  let negative = false;
  if (format.parenthesesNegative && /^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1).trim();
  } else if (value.startsWith("+")) {
    value = value.slice(1).trim();
  }

  const grouping = format.decimalSeparator === "." ? "," : ".";
  // Drop grouping separators, whitespace and currency symbols; keep the decimal sep.
  const withoutGrouping = value.split(grouping).join("");
  const stripped = withoutGrouping.replace(/[\s\p{Sc}]/gu, "");
  const canonical = stripped.split(format.decimalSeparator).join(".");

  if (!/^\d+(\.\d+)?$/.test(canonical)) {
    throw new RowRejection(`unparseable amount "${raw}"`);
  }

  const isZero = /^0+(\.0+)?$/.test(canonical);
  const sign: -1 | 0 | 1 = isZero ? 0 : negative ? -1 : 1;
  return { magnitude: canonical, sign };
}
