# 0005. Evaluation harness and CI eval gate

- **Status:** Accepted
- **Date:** 2026-06-08
- **Phase:** 5
- **Builds on:** spec 0004 (Q&A agent), ADR-0009 (eval design), ADR-0004
  (determinism-first), ADR-0005 (money), ADR-0007 (MCP server + dependency
  direction), ADR-0008 (agent design).

## Summary / Goal

An evaluation harness that runs the **real** Phase 4 Q&A agent against a fixed,
committed golden dataset and scores its answers — the project's differentiator.
It costs API tokens, so it is a **separate command** (`pnpm eval`) and a
**manual/scheduled CI job**, never part of `pnpm check` / `pnpm test` /
`test:integration`. v1 evaluates the Q&A agent; the categoriser is a v1.1
follow-up (the harness core is feature-agnostic).

## Determinism-vs-LLM decision (central)

| Unit of work | Kind | Rationale |
|---|---|---|
| Seeded account state (the golden world) | **deterministic** | Committed fixed transactions; categories applied **by rule**, never the LLM, so the world is reproducible. |
| Ground-truth figures | **deterministic** | Committed in the dataset **and** recomputed from the seed via the real folds in a unit test (no drift). |
| Tool-selection scoring | **deterministic** | Set comparison of `expectedTools` vs the agent's `toolCalls`. |
| Figure / answer scoring | **deterministic** | String/decimal matching of the answer against committed ground truth. |
| Faithfulness scoring | **deterministic** | Re-execute the agent's actual tool calls against the seed → the legitimate figure set; flag any other money token. |
| Scope scoring | **deterministic** | No `list_accounts`; every call scoped to the account. |
| The agent's tool choice + answer phrasing | **LLM** | The thing under test (Phase 4). |
| Answer-quality judging (`--judge`) | **LLM** | Opt-in, **reported only, never gating** — keeps the gate cheap + deterministic. |

**Gate = tool-selection + answer**, both ≥ 0.9 (configurable). Faithfulness +
scope are reported in v1; faithfulness is promoted to gating once its
false-positive rate is observed to be 0 (ADR-0009 §2).

## The deterministic seed (`@ledger-lens/db`)

`seedDemo(db)` — idempotent — seeds the two stable accounts and a fixed
transaction set:

- **USD** `Everyday Checking` (`aaaaaaaa-…`): May 2026 payroll + ~11 categorised
  debits (groceries, transport, dining, housing, subscriptions, shopping,
  utilities, health), **plus an April payroll** so "net in May" ≠ "net all-time".
- **EUR** `Cuenta Nómina` (`bbbbbbbb-…`): May 2026 payroll + ~7 categorised debits,
  with **distinct magnitudes** from the USD account so any scope leak changes the
  number.

Mechanics: `seedAccounts` (existing) → `persistIngestion` (fixed drafts with
deterministic fingerprints) → `applyCategorizations` keyed by description (the
known category labels are part of the committed seed, **not** an LLM output).
Exposed for the harness: the raw seed rows (for ground-truth verification) and the
account ids. Available as a `db:seed:demo` dev script; `pnpm eval` calls `seedDemo`
directly (the base `db:seed` still seeds accounts only).

## The golden dataset (`packages/evals`)

A typed, Zod-validated TS module. ~13 cases:

```ts
type ToolExpectation = DomainTool | DomainTool[];   // single must-appear, or any-of
type GroundTruth =
  | { kind: "figure"; money: MoneyDTO }             // answer must contain this figure
  | { kind: "text"; contains: string[] }            // answer must contain these (e.g. "housing")
  | { kind: "refusal" };                            // answer must NOT fabricate a figure

interface EvalCase {
  readonly id: string;
  readonly question: string;
  readonly accountId: string;                       // a seed account
  readonly expectedTools: readonly ToolExpectation[];
  readonly groundTruth: GroundTruth;
  readonly derivation: Derivation;                  // how groundTruth is computed from the seed
  readonly notes?: string;
}
```

`Derivation` is `{ metric: "net" | "totalIn" | "totalOut" | "categorySpend" |
"topCategoryName" | "topCategoryAmount"; dateFrom?; dateTo?; category? }`. The
consistency test computes `computeGroundTruth(seedRows, derivation)` with the real
folds and asserts it equals the committed `groundTruth` (figure/text cases).
Refusal cases carry a `derivation` of `{ metric: "none" }`.

Coverage: net (month + all-time), top-category name + amount, per-category spend
(groceries, dining), total in, total out (any-of summarize tool), the EUR account
(net + groceries + top category), and 2 refusals (out-of-scope; an average the
tools can't compute).

## Scoring (`packages/evals`, pure + unit-tested)

- `scoreToolSelection(actualTools, expectations) → { pass, missing, extra }` —
  each expectation satisfied (single present, or any-of present); `extra` reported.
- `scoreAnswer(answer, groundTruth, allowedFigures) → { pass, detail }` —
  - figure → `answerContainsDecimal(answer, render(money))`;
  - text → all `contains` present (case-insensitive);
  - refusal → no fabricated figure (= faithfulness holds with no ground-truth
    figure to allow).
- `scoreFaithfulness(answer, allowedFigures, groundTruth?) → { pass, offenders }` —
  money tokens in the answer outside `allowedFigures` ∪ ground truth.
- `scoreScope(toolCalls, scopedAccountId) → { pass, violations }`.

Money matching helpers (the crux; exhaustively unit-tested): `renderDecimal(dto)`
(via shared `toDecimalString`), `extractMoneyTokens(text)` (maximal numeric runs
with optional grouping/decimals), `answerContainsDecimal(text, decimal)`
(comma-stripped token match, boundary-guarded so `12504.02` ≠ `2504.02` and
`2504.029` ≠ `2504.02`, tolerating a dropped all-zero fraction so `2000.00` also
matches `2000`).

## The runner (`apps/api/src/evals/`, the thin executable)

`run-eval.ts` (`pnpm eval`, real API + an ephemeral DB; a `.ts`, never picked up
by vitest):

1. Require `ANTHROPIC_API_KEY` (no `DATABASE_URL`); parse args (`--models`,
   `--judge`, `--out`, thresholds).
2. Start a **throwaway `PostgreSqlContainer`** (testcontainers), set
   `process.env.DATABASE_URL` to its URI **before** any agent call (so the agent's
   MCP child reads this DB), then `createDatabase` → `applyMigrations` →
   `seedDemo`. The container is stopped in `finally`. The world is built fresh
   every run, isolated from the dev DB — so the eval can't read contaminated state.
3. For each model: build `AgentSdkQaAgent({ model, maxTurns, maxBudgetUsd })`
   (the `AgentRunner` port impl). For each case: `agent.ask` → `{ answer,
   toolCalls, turns, costUsd }`.
4. Build `allowedFigures` by **re-executing** the case's actual `toolCalls`
   against the seeded DB (the MCP tool handlers from `@ledger-lens/mcp-server`),
   then score (tool-selection, answer, faithfulness, scope) via
   `@ledger-lens/evals`. Optionally call the judge (`@anthropic-ai/sdk`) and
   attach the verdict.
5. Aggregate → `report.json` + `report.md` (+ comparison table for multiple
   models) in `--out` (default `packages/evals/reports/`, gitignored).
6. Exit non-zero if the **primary** model's tool-selection or answer rate is below
   threshold.

The runner implements the port with the real agent; `packages/evals` never imports
`apps/api` (dependency direction app → package).

## Module layout

- **`@ledger-lens/db`**: `demo-seed.ts` (`seedDemo`, seed rows, account ids);
  re-exported from `index.ts`; exposed as the `db:seed:demo` script.
- **`@ledger-lens/mcp-server`**: widen `index.ts` to also export the tool handlers
  + aggregation folds + schemas (needed by the runner's re-execution and the
  consistency test).
- **`packages/evals/src/`**: `dataset.ts` (cases + Zod schema + `loadDataset`),
  `ground-truth.ts` (`computeGroundTruth` over the folds), `money-match.ts`,
  `scoring.ts`, `report.ts` (JSON + Markdown + comparison), `judge.ts`
  (`buildJudgePrompt` / `parseJudgeVerdict`), `runner.ts` (the `AgentRunner` port
  + result types), `index.ts`, and `*.test.ts` for each pure module.
- **`apps/api/src/evals/`**: `run-eval.ts` (executable), `agent-runner.ts`
  (`AgentSdkQaAgent` → port), `faithfulness.ts` (re-execute tool calls → figures),
  `judge-client.ts` (the `@anthropic-ai/sdk` call).

## Testing strategy (NO real API in any suite)

- **Unit (`packages/evals/**/*.test.ts`, in `pnpm check`, Docker-free):** the
  money matcher (separators, dropped `.00`, EUR cents, superset/substring
  non-matches), tool-selection containment + any-of, answer scoring per kind,
  faithfulness offender detection, scope, dataset Zod validation, report
  JSON→Markdown + aggregation, judge prompt/parse — all with **mocked** agent
  outputs.
- **Consistency (`packages/evals`):** every figure/text case's committed
  `groundTruth` equals `computeGroundTruth(seedRows, derivation)` — the
  dataset-can't-drift-from-the-seed guard.
- **Real-API run (`pnpm eval`, manual/scheduled):** the only path that calls the
  real API — like the smoke, excluded from all suites and CI's per-commit gates.

## New dependencies

- `packages/evals`: `zod`, `@ledger-lens/shared`, `@ledger-lens/db` (prod);
  `@ledger-lens/mcp-server`, `vitest`, `@types/node`, `typescript`, `tsx` (dev).
- `apps/api` runner: **no new third-party deps** — reuses
  `@anthropic-ai/claude-agent-sdk`, `@ledger-lens/db`, `@ledger-lens/mcp-server`,
  `@anthropic-ai/sdk` (judge), and `@testcontainers/postgresql` (the ephemeral DB —
  already a devDependency for the integration tests). Commit `pnpm-lock.yaml`.
- A minor internal change: optional `costUsd` on `QaAnswer` (set by the adapter,
  which already computes it; the HTTP response is unchanged — cost is still never
  returned to the client).

## CI

`.github/workflows/eval.yml` — `workflow_dispatch` + weekly `schedule` (never
push/PR). **No Postgres service** — the runner provisions its own throwaway
Postgres via testcontainers (ubuntu runners have Docker). `pnpm eval` with
`ANTHROPIC_API_KEY` as a GitHub secret; report uploaded as an artifact; job fails
on a sub-threshold gate. `ci.yml` is unchanged.

## Out of scope (later phases)

- The categoriser eval (dataset + classification scorer) — v1.1.
- Promoting faithfulness to a gating metric — after observing 0 false positives.
- Latency budgeting and historical trend tracking across runs (Phase 8 report).
- Extracting `packages/agent` (only if the agent gains a consumer outside
  `apps/api`).
