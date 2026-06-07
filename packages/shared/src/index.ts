/**
 * @ledger-lens/shared
 * Cross-cutting types and schemas shared across web, api, mcp-server and evals.
 * Real domain types land in Phase 1; this is the Phase 0 toolchain anchor.
 */

export const PROJECT_NAME = "ledger-lens" as const;

/** Where a unit of work sits on the determinism <-> LLM spectrum (see ADR-0004). */
export type ComputeKind = "deterministic" | "llm-assisted" | "agentic";

export interface FeatureBoundary {
  readonly name: string;
  readonly kind: ComputeKind;
  readonly rationale: string;
}

// Domain core (Phase 1). Money & currency are the foundation; the normalized
// Account/Statement/Transaction model builds on them.
export * from "./domain/currency.js";
export * from "./domain/money.js";
export * from "./domain/iso-date.js";
export * from "./domain/text.js";
export * from "./domain/account.js";
export * from "./domain/statement.js";
export * from "./domain/transaction.js";
// Enrichment (Phase 2): the closed category taxonomy assigned by the LLM.
export * from "./domain/category.js";
