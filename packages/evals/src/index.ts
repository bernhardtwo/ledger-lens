/**
 * @ledger-lens/evals — the evaluation harness (Phase 5; ADR-0009, spec 0005).
 *
 * Pure, app-independent, and unit-tested with mocked agent output: the golden
 * dataset + loader, the deterministic scorers, the report builders, the optional
 * LLM-judge helpers, and the `AgentRunner` port the real runner (in `apps/api`)
 * implements. Nothing here calls the real Claude API.
 *
 * `ground-truth.ts` is intentionally NOT re-exported — only the consistency test
 * uses it, which keeps `@ledger-lens/mcp-server` a devDependency.
 */
export * from "./dataset.js";
export * from "./money-match.js";
export * from "./scoring.js";
export * from "./judge.js";
export * from "./report.js";
export * from "./runner.js";
