# 0009. Eval harness and CI eval gate

- **Status:** Accepted
- **Date:** 2026-06-08

## Context

Phase 5 adds the project's differentiator: an **evaluation harness** that
*measures* whether the LLM features clear a quality bar instead of hoping they
do. v1 targets the Phase 4 **Q&A agent** (ADR-0008, spec 0004) — it runs the
**real** agent (real Agent SDK + real MCP-over-stdio + real DB) against a fixed
golden dataset and scores the answers.

Three forces shape the design:

1. **It costs API tokens.** A real-agent run is the opposite of the rest of CI
   (deterministic, Docker-only, offline). So the eval **must not** run on every
   push/PR — it is a separate command and a manual/scheduled CI job against the
   spend-limited workspace, never part of `pnpm check` / `pnpm test` /
   `test:integration`.
2. **Determinism-first applies to *scoring*, not just the feature** (ADR-0004).
   A gate that flakes is worse than no gate. The **gating** metrics are pure
   deterministic comparisons (tool selection, figure presence); an LLM-as-judge
   is *reported only*, never gating, so the gate stays cheap and reproducible.
3. **The README reserves `packages/evals`** "behind every LLM feature". The
   harness lives there, but it must *invoke* the agent, which lives in
   `apps/api` — and a package must not depend on an app (the ADR-0007 dependency
   rule). This drives the packaging split below.

## Decision

**1. v1 scope = the Q&A agent; the categoriser is deferred to v1.1.** The harness
**core is feature-agnostic** (dataset loader, scorers, report builder, and an
`AgentRunner` port), so the categoriser eval drops in later as *a new dataset + a
new scorer*, not a rearchitecture. The README's "behind every LLM feature"
promise therefore holds by **design + roadmap**: the agent is covered now, the
categoriser scorer is a planned v1.1 addition (and the categoriser already has
deterministic full-loop CI coverage via its e2e itest in the meantime).

**2. Four metrics; the gate is the two deterministic ones.** Per case:

| Metric | Kind | Gating? | Definition |
|---|---|---|---|
| **Tool selection** | deterministic | **gating** | Every expectation is satisfied by the agent's `toolCalls`. An expectation is a tool name (must appear) or a set of alternatives (at least one appears, for questions answerable by either summarize tool). Exactness (no extra tools) is reported, not gated. |
| **Answer (figure)** | deterministic | **gating** | `figure` cases: the answer contains the ground-truth `MoneyDTO` rendered as a decimal (robust matcher: strips `$`/`€` + thousands separators, boundary-guards numeric tokens, tolerates a dropped trailing `.00`). `text` cases: contains the required substring(s). `refusal` cases: contains **no** fabricated figure. |
| **Faithfulness** | deterministic | reported (v1) | No money-shaped token in the answer outside the figures the agent actually saw (see §5) ∪ the ground truth. |
| **Scope held** | deterministic | reported | No `list_accounts`; every tool call's `accountId` is the scoped account. (Largely guaranteed by `canUseTool` injection — a regression tripwire.) |

Starting gate thresholds: **tool-selection ≥ 0.9, answer ≥ 0.9** (configurable).
**Faithfulness is the most important determinism-first signal long-term**, but is
**reported-only in v1** to avoid a brittle gate from money-token matcher
false-positives on a real-API run. **It is promoted to a gating metric once its
false-positive rate is observed to be 0 on the v1 golden set** — this promotion is
a tracked follow-up, not an open question.

**3. A committed, reproducible seed; ground truth verified against it.** A new
`seedDemo(db)` in `@ledger-lens/db` seeds the two stable accounts (USD + EUR) with
a fixed set of transactions — fixed dates/amounts/directions, deterministic
fingerprints, and **categories applied by rule, never by the LLM** (via
`persistIngestion` → `applyCategorizations` keyed by description). Idempotent. The
seed lives in `db` because it is reusable by dev seeding, the smoke, and the
evals. Ground-truth figures in the dataset are **committed** (readable, explicit)
**and** checked by a unit test that recomputes them from the seed rows via the
**same aggregation folds the tools use** (`summarizeAccountFlow` /
`summarizeSpendingByCategory`). So the dataset can never silently drift from the
seed, and the eval's notion of "truth" is identical to the tools' math.

**4. A small, typed, Zod-validated golden dataset in `packages/evals`.** ~13 cases
across both accounts (currency coverage): net flow (a month + all-time), top
category (name + amount), per-category spend, total in/out, and **two refusals**
(an out-of-scope question; a figure the tools cannot produce, e.g. an average —
which the agent must decline rather than compute). Each case is `{ id, question,
accountId, expectedTools, groundTruth }` where `groundTruth` is a discriminated
union `figure | text | refusal`, plus a `derivation` describing how it is computed
from the seed (the input to the consistency test in §3).

**5. Faithfulness via re-execution — no agent change.** The agent's `QaAnswer`
already carries `toolCalls` (tool + the exact input). The runner reconstructs the
set of legitimate figures by **re-running those same tool calls against the seeded
DB** (the tools are deterministic, so re-execution reproduces precisely what the
agent saw). Any money token in the answer outside that set ∪ the ground truth is a
fabrication offender. The **scorer is pure** (answer + allowed-figure set →
offenders; unit-tested in `packages/evals`); only the **gathering** of the
allowed set (re-executing handlers, DB I/O) lives in the runner and is exercised
by the real-API path, like the smoke.

**6. Deterministic-first scoring; optional LLM judge, reported only.** An opt-in
`--judge` flag scores answer *quality* with one cheap Claude call per case
(question + ground truth + answer → `{ score 1–5, rationale }`). It is **off by
default** and **never gating**, so the default eval is cheap and fully
deterministic. Prompt building + verdict parsing are pure (tested in
`packages/evals`); the API call lives in the runner. Cost: ~one extra cheap call
per case (a few cents per run on Haiku).

**7. Model comparison via `--models`.** The runner accepts
`--models claude-haiku-4-5,claude-sonnet-4-6` (defaults to the single
`ANTHROPIC_AGENT_MODEL`) and runs the **same golden set per model**, emitting a
per-model report plus a comparison table (per-metric pass rates, cost, avg turns)
— the data to decide the Haiku→Sonnet switch. The **gate evaluates the primary
model only** (the env model CI runs by default); additional `--models` are
comparison-only, so deliberately comparing against a weaker model never fails the
gate.

**8. Packaging: pure `packages/evals` + a thin runner in `apps/api`.**
- `packages/evals` is the **app-independent harness**: the dataset + Zod loader,
  the pure scorers, the report builders (JSON + Markdown), the model-comparison
  aggregation, the judge prompt/parse helpers, and the `AgentRunner` **port**. It
  depends only on `@ledger-lens/shared` + `@ledger-lens/db` (and dev-depends on
  `@ledger-lens/mcp-server` for the folds the consistency test uses). **No app
  dependency, no real API**; unit-tested with **mocked** agent outputs.
- `apps/api` hosts the executable (`pnpm eval` → `src/evals/run-eval.ts`): it
  implements the `AgentRunner` port with the real `AgentSdkQaAgent`, seeds via
  `@ledger-lens/db`, loops the dataset and scores + writes the report via
  `@ledger-lens/evals`, and exits non-zero on a threshold breach.

This keeps the dependency direction correct (app → package), puts all the
reusable/testable logic in the reserved package, and places only the agent-wiring
where the agent already lives — mirroring how `smoke:ask` lives in `apps/api`.
The agent is **not** extracted into `packages/agent`: unlike `db` (promoted out of
`apps/api` once the MCP server became a second consumer, ADR-0007), the agent's
only consumers are both inside `apps/api` (the HTTP endpoint and this runner), so
it does not meet that extraction trigger. Kept as a possible later move.

**9. How it runs + CI — against an ephemeral, self-built DB.** `pnpm eval` is the
command (real API; **not** in `pnpm check` / `pnpm test` / `test:integration`).
The determinism-first rule applies to the eval's *substrate* too: the runner
builds its world fresh every run rather than trusting whatever sits in a dev DB.
It starts a **throwaway Postgres via testcontainers** (the same pattern the
integration tests use), `applyMigrations` + `seedDemo` into it, and sets
`process.env.DATABASE_URL` to the container URI **before** invoking the agent — so
the agent's MCP child queries the *same* ephemeral world — then stops the
container in `finally`. The eval can therefore never read contaminated state (e.g.
smoke leftovers) from a shared DB; it just needs Docker running, and
`DATABASE_URL` is no longer an input. Ephemeral-only for v1 (no dev-DB escape
hatch, so the footgun can't return); a `--database-url` override can be added
later if ever needed.

A **separate** `.github/workflows/eval.yml` runs on **`workflow_dispatch` + a
weekly `schedule`** (never push/PR): it runs `pnpm eval` with `ANTHROPIC_API_KEY`
as a GitHub secret (the runner self-provisions Postgres — **no service
container**), uploads the report as an artifact, and fails the job on a
sub-threshold gate. The existing `ci.yml` is unchanged — the deterministic +
integration suites stay exactly as they are.

**10. Report = `report.json` + `report.md`, gitignored.** Machine-readable totals
+ per-case detail (metrics, answer, tool calls, turns, cost) and a human Markdown
summary with the multi-model comparison table — the raw material for the Phase 8
eval report.

A minor enabling change: the agent adapter already computes a run's
`total_cost_usd` (logged server-side). It now also sets an optional `costUsd` on
the **internal** `QaAnswer` so the report can carry per-case cost. The HTTP `ask`
response mapping is unchanged and still never returns cost to the client
(ADR-0008 §6 holds).

## Alternatives considered

- **Cover the categoriser in v1** — rejected for v1: a different metric shape
  (classification accuracy/precision/recall) that would widen scope; the harness
  is built feature-agnostic so it lands cleanly in v1.1, and the categoriser is
  already CI-covered deterministically.
- **Gate on faithfulness immediately** — rejected for v1: real-API answers vary in
  phrasing, and a money-token matcher false-positive would flake the gate. Kept
  reported with an explicit promotion criterion (false-positive rate 0).
- **LLM-as-judge as a gating metric** — rejected: a non-deterministic gate
  contradicts ADR-0004 and burns tokens per gate decision. Judge stays reported.
- **Compute ground truth at runtime from the seed** — rejected in favour of
  *committed* ground truth *verified* against the seed by a unit test: the figures
  are reviewable in the dataset, and drift is still caught.
- **Extract the agent into `packages/agent`** so `packages/evals` owns the whole
  runner — rejected (deferred): heavier, touches Phase 4, and the agent has no
  second consumer outside `apps/api` yet. The port seam recovers the testability.
- **Put the runner in `packages/evals` and depend on `@ledger-lens/api`** —
  rejected: inverts the dependency graph (package → app), the exact thing
  ADR-0007 avoided.

## Consequences

- **Positive:** a measured quality bar for the agent with a cheap, deterministic
  gate; a committed, reproducible account state whose ground truth cannot drift
  from the seed; faithfulness measured by re-execution against the real tool math
  (no agent change); model comparison on demand to drive the Haiku→Sonnet
  decision with data; a structured report feeding the Phase 8 write-up; the
  harness core fully unit-tested offline with no real API in any suite.
- **Negative (accepted):** the real-agent eval is token-spending and lives outside
  the per-commit gates (manual/scheduled only); it now requires **Docker** when run
  (it provisions its own Postgres), as the integration suite already does; a small
  amount of runner-side I/O (agent invocation, faithfulness re-execution, the judge
  call) is exercised only by the real-API path, like the smoke; `packages/evals`
  dev-depends on `@ledger-lens/mcp-server` for the folds used by the consistency
  test.
- **Follow-ups:** promote **faithfulness to a gating metric** once its
  false-positive rate is observed to be 0 on the v1 set; add the **categoriser
  eval** (dataset + classification scorer) in v1.1; revisit extracting
  `packages/agent` if the agent gains a consumer outside `apps/api`; feed the
  reports into the Phase 8 eval report.
