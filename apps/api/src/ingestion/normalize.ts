/**
 * Row normalization (see spec 0001, step 3; ADR-0004 determinism-first).
 *
 * Maps one raw CSV row (header -> cell) into the canonical `NormalizedRow`: ISO
 * dates, a non-negative `Money` magnitude with an explicit `direction`, and a
 * description canonicalized by the shared `normalizeDescription` — the SAME
 * normalizer the fingerprint uses, never reimplemented here. Throws `RowRejection`
 * with a precise reason on any unmappable field; the orchestrator collects it.
 *
 * No LLM: CSV is structured input, so every step is a pure function.
 */
import {
  type Direction,
  type IsoDate,
  type Money,
  fromDecimalString,
  normalizeDescription,
} from "@ledger-lens/shared";
import { parseSignedDecimal } from "./amount.js";
import { parseDate } from "./date.js";
import { RowRejection } from "./errors.js";
import type { MappingProfile } from "./profiles/index.js";
import type { NormalizedRow } from "./types.js";

/** Normalize a single raw row against its mapping profile. */
export function normalizeRow(
  profile: MappingProfile,
  rawRow: Readonly<Record<string, string>>,
): NormalizedRow {
  const transactionDate = parseDate(
    cell(rawRow, profile.transactionDateColumn),
    profile.dateFormat,
  );

  let postedDate: IsoDate | null = null;
  if (profile.postedDateColumn !== null) {
    const postedRaw = cell(rawRow, profile.postedDateColumn).trim();
    postedDate = postedRaw === "" ? null : parseDate(postedRaw, profile.dateFormat);
  }

  const { direction, amount } = resolveAmount(profile, rawRow);
  const description = normalizeDescription(
    profile.descriptionColumns.map((column) => cell(rawRow, column)).join(" "),
  );

  return { transactionDate, postedDate, description, direction, amount, rawRow: { ...rawRow } };
}

/**
 * Derive `direction` + a non-negative `Money` from the profile's amount strategy.
 * A zero / non-positive amount is rejected: the binary debit/credit model has no
 * neutral direction (per the approved spec adjustment).
 */
function resolveAmount(
  profile: MappingProfile,
  rawRow: Readonly<Record<string, string>>,
): { direction: Direction; amount: Money } {
  const strategy = profile.amount;

  if (strategy.kind === "signed-amount") {
    const { magnitude, sign } = parseSignedDecimal(
      cell(rawRow, strategy.column),
      profile.numberFormat,
    );
    if (sign === 0) {
      throw new RowRejection("non-positive amount");
    }
    const isDebit = strategy.debitSign === "negative" ? sign < 0 : sign > 0;
    return {
      direction: isDebit ? "debit" : "credit",
      amount: fromDecimalString(magnitude, profile.currency),
    };
  }

  if (strategy.kind === "debit-credit-columns") {
    const debitRaw = cell(rawRow, strategy.debitColumn).trim();
    const creditRaw = cell(rawRow, strategy.creditColumn).trim();
    const hasDebit = debitRaw !== "";
    const hasCredit = creditRaw !== "";
    if (hasDebit === hasCredit) {
      // Both filled or both empty: no derivable direction.
      throw new RowRejection("ambiguous debit/credit columns");
    }

    const direction: Direction = hasDebit ? "debit" : "credit";
    const { magnitude, sign } = parseSignedDecimal(
      hasDebit ? debitRaw : creditRaw,
      profile.numberFormat,
    );
    if (sign <= 0) {
      throw new RowRejection("non-positive amount");
    }
    return { direction, amount: fromDecimalString(magnitude, profile.currency) };
  }

  // Exhaustiveness: a new AmountStrategy variant must be handled here, or this
  // fails to compile.
  const exhaustive: never = strategy;
  throw new Error(`unhandled amount strategy: ${JSON.stringify(exhaustive)}`);
}

/** Read a profile-declared column from the row; a missing column reads as "". */
function cell(rawRow: Readonly<Record<string, string>>, column: string): string {
  return rawRow[column] ?? "";
}
