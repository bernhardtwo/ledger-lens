# 0004. Determinism-first: an explicit LLM-in-the-loop boundary

- **Status:** Accepted
- **Date:** 2026-06-02

## Context
The role this project targets values engineers who know *when an LLM-in-the-loop
is the right solution versus traditional software*. LLM calls are non-
deterministic, slower, costlier, and can hallucinate. In a financial analyst,
wrong numbers are unacceptable.

## Decision
Adopt a **determinism-first** rule. Every unit of work is classified (in its spec
and in code via `FeatureBoundary` from `@ledger-lens/shared`) as:

- `deterministic` — pure functions. All money math, reconciliation, validation,
  metric computation. **This is the default.**
- `llm-assisted` — a single bounded LLM call with a validated (Zod) structured
  output. E.g. extracting fields from an unstructured PDF, categorising a
  transaction, drafting a natural-language summary.
- `agentic` — multi-step, tool-using agent (Agent SDK + MCP) for open-ended tasks
  like "reconcile last month and explain the anomalies".

Numbers shown to the user are always produced by deterministic code. The LLM may
*decide what to compute and explain the result*, but must not *compute the money*.

## Alternatives considered
- **LLM-first ("just ask the model")** — simplest to build, but unreliable for
  arithmetic and expensive. Rejected.
- **No agents (only single LLM calls)** — safer, but fails the open-ended
  multi-step use cases and would not demonstrate agentic engineering.

## Consequences
- Positive: correctness where it matters; lower cost; clear, testable boundaries;
  evals can target each `llm-assisted`/`agentic` unit specifically.
- Negative (accepted): some orchestration glue between deterministic tools and the
  agent. This glue is exactly what the MCP server (Phase 3) formalises.
