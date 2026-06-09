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
