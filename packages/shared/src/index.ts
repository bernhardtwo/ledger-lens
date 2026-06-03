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

// Domain core (Phase 1). Money & currency land first; transactions/accounts next.
export * from "./domain/currency.js";
export * from "./domain/money.js";
