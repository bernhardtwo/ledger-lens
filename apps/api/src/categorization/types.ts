/**
 * Categorization core types (see spec 0002, ADR-0006). SDK-free — these describe
 * the pure core and the mockable client seam.
 */
import type { Category, CurrencyCode, Direction } from "@ledger-lens/shared";

/**
 * One transaction presented to the model, identified by a compact batch-local
 * `index` (1..N) — never the UUID (which the model garbles and which wastes
 * tokens). `amount` is a human decimal string and is context only — the model
 * never does arithmetic.
 */
export interface CategorizationItem {
  readonly index: number;
  readonly description: string;
  readonly direction: Direction;
  readonly amount: string;
  readonly currency: CurrencyCode;
}

/**
 * The network seam the pure core depends on. The only thing that touches the
 * Claude API; mocked in every test.
 */
export interface CategorizationClient {
  /** The model id used, recorded for audit/eval. */
  readonly modelId: string;
  /** One forced-tool categorization call; returns the raw, **unvalidated** tool input. */
  categorize(items: readonly CategorizationItem[]): Promise<unknown>;
}

/** A transaction the core can categorize: an id plus the model's context fields. */
export interface CategorizableTransaction {
  readonly id: string;
  readonly description: string;
  readonly direction: Direction;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
}

/** Outcome of a full categorization run. */
export interface CategorizationRun {
  /** Transaction id -> assigned category (real or `uncategorized`) for resolved items. */
  readonly assignments: ReadonlyMap<string, Category>;
  /** Ids whose batch failed at the transport layer — left `NULL` for a later retry. */
  readonly failedIds: readonly string[];
}
