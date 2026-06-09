# @ledger-lens/evals

Evaluation harness (Phase 5) — the project's differentiator. See ADR-0009 /
spec 0005.

It runs the **real** Q&A agent against a fixed, committed golden dataset and
scores its answers, so it **costs API tokens** — it is a separate command
(`pnpm eval`) and a manual/scheduled CI job, **never** part of `pnpm check` /
`pnpm test` / `test:integration`.

## What lives here (pure, app-independent, unit-tested with mocked agent output)

- **`dataset.ts`** — the golden cases (`question → expected tool(s) + ground
  truth`), a Zod schema, and `loadDataset()`. Ground truth is **committed** and
  verified against the seed by a unit test (`computeGroundTruth` in
  `ground-truth.ts`), so it can't silently drift.
- **`money-match.ts`** — deterministic money-token matching (the crux).
- **`scoring.ts`** — the four metrics: tool-selection + answer (**gating**),
  faithfulness + scope (reported).
- **`report.ts`** — JSON + Markdown report builders and model comparison.
- **`judge.ts`** — optional LLM-as-judge prompt/parse helpers (reported only).
- **`runner.ts`** — the `AgentRunner` port the real runner implements.

The executable that wires the real agent + DB lives in **`apps/api`**
(`pnpm eval`), because a package must not depend on an app (ADR-0007). This
package never imports `apps/api` and never calls the real API.

## v1 scope

v1 evaluates the **Q&A agent**. The harness core is **feature-agnostic**, so the
Phase 2 categoriser scorer drops in as a new dataset + scorer in v1.1.

## Model decision (Phase 5)

The agent default is **`claude-haiku-4-5`**, chosen on this harness's data. On the
23-case golden set — multi-tool composition (`all`), partial/edge date ranges,
large odd-cents figures, honesty refusals, both currencies — Haiku and
`claude-sonnet-4-6` **both scored 100%** on every metric, so the call is cost:
Haiku ran ~26% cheaper at the same turn count/latency. **Caveats (honest):** this is
a **single run** (the Agent SDK exposes no temperature, so runs vary), and on the
one *ambiguous* case before it was fixed, Sonnet showed marginally more
conservative determinism-first judgment. So Haiku is the **cost-justified** default,
not proven-superior — flip `ANTHROPIC_AGENT_MODEL` to Sonnet if production shows the
agent over-assuming. See ADR-0008 §5 / ADR-0009 §7.

## Running

The runner builds its own **ephemeral Postgres** every run (via testcontainers,
like the integration tests): it migrates + seeds a throwaway DB and points the
agent at it, so the eval world is fresh and isolated — the dev DB is never
touched. You just need **Docker running** and `ANTHROPIC_API_KEY` set; no
`DATABASE_URL`.

```bash
pnpm eval                                  # Haiku (default), needs ANTHROPIC_API_KEY + Docker
pnpm eval -- --models claude-haiku-4-5,claude-sonnet-4-6 --judge
```
