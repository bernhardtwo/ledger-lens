/**
 * Mapping-profile types (see spec 0001, "CSV ingestion design").
 *
 * A profile is **pure config, never an LLM**: it declares how one bank's CSV
 * layout translates into the canonical Transaction fields. Profiles are matched
 * to a file by header signature (see `resolveProfile`).
 */
import type { CurrencyCode } from "@ledger-lens/shared";

/** Supported source date layouts. Declared per profile; parsed without locale guessing. */
export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

/** How a bank encodes the value (and sign) of a row. */
export type AmountStrategy =
  | {
      /** A single signed column; `debitSign` says which sign means money out. */
      readonly kind: "signed-amount";
      readonly column: string;
      readonly debitSign: "negative" | "positive";
    }
  | {
      /** Two columns; the filled one decides direction (both/neither filled => reject). */
      readonly kind: "debit-credit-columns";
      readonly debitColumn: string;
      readonly creditColumn: string;
    };

/** Deterministic numeric parsing rules for this bank's amount cells. */
export interface NumberFormat {
  /** "," for European decimals; the other of [".", ","] is then treated as grouping. */
  readonly decimalSeparator: "." | ",";
  /** When true, "(123.45)" denotes a negative amount (signed-amount banks only). */
  readonly parenthesesNegative: boolean;
}

/** A versioned mapping profile for one bank's CSV export. */
export interface MappingProfile {
  /** Stable, versioned id, e.g. "bank-a@v1". */
  readonly id: string;
  /** Raw expected headers; the matcher canonicalizes them (trim/lowercase/sort). */
  readonly expectedHeaders: readonly string[];
  /** One currency per file this phase (see spec / ADR-0005). */
  readonly currency: CurrencyCode;
  readonly dateFormat: DateFormat;
  /** Column -> canonical `transactionDate` (required). */
  readonly transactionDateColumn: string;
  /** Column -> `postedDate`, or `null` when the bank has no separate posting date. */
  readonly postedDateColumn: string | null;
  /** One or more columns, joined with " " then run through `normalizeDescription`. */
  readonly descriptionColumns: readonly string[];
  readonly amount: AmountStrategy;
  readonly numberFormat: NumberFormat;
}
