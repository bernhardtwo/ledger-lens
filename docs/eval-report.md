# Evaluation report

How LedgerLens keeps its **LLM features honest**. The agent is the only
non-deterministic component in the system, so it is the one component held to a measured
bar rather than a vibe. This report is the curated story; the raw, per-case output is
**regenerated** by `pnpm eval` into `packages/evals/reports/{report.json,report.md}`
(gitignored — it's a run artifact). The summary tables below are from that run.

> TL;DR — on a 23-case discriminating golden set, **Haiku scores 100%** on every gating +
> reported metric at ~27% lower cost than Sonnet, so Haiku is the **cost-justified**
> default. The harness earns its keep: it **caught a determinism-first violation in my own
> code** (the agent doing money math) and a **mis-specified eval case**. The numbers are
> reported **as-run**, caveats included.

## Why an eval harness at all

Determinism-first ([ADR-0004](adr/0004-determinism-first-llm-boundary.md)) says the model
decides *what* to compute and phrases results, while pure functions compute the money. That
boundary is only credible if the agent's behaviour is **measured**: does it pick the right
tool, relay the right figure, refuse what the tools genuinely can't answer, and never stray
to another account? A unit test can't ask that of an LLM; an eval can. The harness runs the
**real** agent (Agent SDK → MCP → Postgres) against committed golden cases and scores it
deterministically — so it's a gate, not a vibe-check. See
[ADR-0009](adr/0009-eval-harness-and-ci-eval-gate.md) and
[spec 0005](specs/0005-evaluation-harness.md).

## The golden set (23 cases, designed to discriminate)

The set is built to **separate a good agent from a plausible-but-wrong one**, not to be
easy. Beyond basic single-figure lookups it includes:

- **Multi-tool composition** (`kind: "all"`) — the answer must relay **both** results and
  both tools must be called (e.g. net *and* groceries in one question).
- **Edge / partial / ambiguous date ranges** — a single month, a quarter, and a
  month-straddling partial range (`04-20…05-05`) — discriminating on picking the *right*
  range.
- **Large odd-cents figures** — e.g. a `15,175.43` bonus — exercising the decimal path
  that the ÷100 bug below corrupted.
- **Honesty refusals** — questions the tools genuinely can't answer (credit score, balance,
  forecast, an average the tools don't compute). A good agent **declines without
  fabricating a figure**; a bad one invents one or hand-computes.
- **Both currencies** (USD + EUR accounts) and **account-scope** probes.

Cases live in [`packages/evals/src/dataset.ts`](../packages/evals/src/dataset.ts).

## Methodology

Each case is scored on four deterministic dimensions:

| Dimension | What it checks | Gating? |
|---|---|---|
| **Tool selection** | the expected tool(s) were called (set containment) | ✅ gates ≥ 90% |
| **Answer** | by ground-truth kind: the right `figure` appears / required substrings present / a `refusal` fabricates no figure / `all` parts pass | ✅ gates ≥ 90% |
| **Faithfulness** | every money-shaped figure in the answer is one the agent actually saw (reconstructed by re-executing its tool calls) — no fabrication | reported |
| **Scope** | no `list_accounts`, and no tool call against a *different* account id | reported |

The **primary gate** is tool-selection + answer, both **≥ 90%** (`DEFAULT_THRESHOLDS`).
Faithfulness + scope are reported in v1 and promoted to gating once their false-positive
rate is observed at zero. An optional `--judge` (LLM-as-judge) is **reported-only, never
gating**. Scoring is in [`packages/evals/src/scoring.ts`](../packages/evals/src/scoring.ts).

## Results — fresh two-model run

`pnpm eval --models claude-haiku-4-5,claude-sonnet-4-6` (generated 2026-06-14, no judge):

| Model | Tool sel | Answer | Faithful | Scope | Cost (USD) | Avg turns | Gate |
|---|---|---|---|---|---|---|---|
| `claude-haiku-4-5` | 100% | 100% | 100% | 100% | 0.385 | 2.0 | ✅ PASS |
| `claude-sonnet-4-6` | 100% | **96%** | 100% | 100% | 0.526 | 2.0 | ✅ PASS |

Both clear the gate. On this run **Sonnet missed exactly one case** — `usd-june-net`, a
figure-extraction case where its answer didn't surface the expected `17826.43`. Haiku got
all 23.

## The model decision — and its honest caveats

**`claude-haiku-4-5` is the default, chosen on *cost*.** Both models clear the gate; Haiku
ran **~27% cheaper** ($0.385 vs $0.526) at the same turn count and latency. That's the whole
basis — and the caveats matter as much as the result:

- **Single run, no temperature control.** The Agent SDK exposes no temperature knob, so
  runs vary. One pass of 23 cases is **thin evidence**, and this run *demonstrates* the
  variance: the more expensive model (Sonnet) scored **lower** here (96% vs 100%). That is
  **not** evidence Haiku > Sonnet — it's evidence that a single run doesn't establish a
  ranking. Both pass; the cost gap is the durable signal, the score gap is noise.
- **Where Sonnet looked better (before a fix).** On the one *ambiguous* case before it was
  reworded (the "income" case below), Sonnet showed marginally more conservative
  determinism-first judgment — it declined to hand-sum rather than treating total inflow as
  income, the behaviour this project prizes.

So Haiku is the **cost-justified default, not a proven-superior one.** The model is a
one-line switch (`ANTHROPIC_AGENT_MODEL=claude-sonnet-4-6`) — flip it if production shows
the agent over-assuming on under-specified questions. (See
[ADR-0008 §5](adr/0008-qa-agent-over-mcp-tools.md).)

## Two bugs the eval surfaced (the harness earning its keep)

Building and running the comparison set caught **two real defects the eval exists to
catch** — the strongest evidence that "measured, not hoped for" is more than a slogan.

### 1. A determinism-first violation in my own code (the ÷100 bug)

The tools handed the agent money as **minor-unit integers** (e.g. `750402`), and the
**LLM did the ÷100 decimal placement itself** — mis-rendering large magnitudes as
`$750,402.00` instead of `$7,504.02`, **worst on Haiku**. Decimal placement *is* money
math, so the fix was **architectural, not a prompt tweak**: the MCP tools now emit a
deterministic `decimal` string (`ToolMoneySchema = MoneyDTO ∩ { decimal }`), and the agent
is directed to **relay it verbatim and never convert**. The figure pass-rate recovered to
100% after the fix, **disproportionately for Haiku** — exactly the determinism-first signal
Phase 5 exists to provide. (Commit `0da69c7`;
[ADR-0007 §2a](adr/0007-domain-mcp-server.md), [ADR-0008 §4a](adr/0008-qa-agent-over-mcp-tools.md).)

### 2. A mis-specified eval case (fix the test, not the model)

A case asked "how much **income**…", but the tools can't isolate income — `totalIn` is all
credits, which equalled income only by **seed coincidence**. The original wording rewarded a
**semantic leap over a determinism-respecting refusal**. The fix was to **reword the case**
(to "total inflow", which `summarize_account.totalIn` answers honestly) rather than retune a
model to the flawed question — so the comparison can't be gamed. Catching a flaw in your own
benchmark is the kind of rigor a benchmark is supposed to enforce. (Commit `83a312b`;
[ADR-0009 §7](adr/0009-eval-harness-and-ci-eval-gate.md).)

## Reproduce

```bash
# Needs ANTHROPIC_API_KEY + Docker (the harness builds its own ephemeral Postgres via
# testcontainers, migrates + seeds it, and points the agent at it — the dev DB is untouched).
pnpm eval                                                   # default: Haiku
pnpm eval --models claude-haiku-4-5,claude-sonnet-4-6       # the two-model table above
```

Reports are written to `packages/evals/reports/{report.json,report.md}`; the runner exits
non-zero if the **primary** model misses the gate. It runs the real agent, so it spends
tokens — it's a manual/scheduled job, never part of `pnpm check`.
