# 0008. Q&A agent over MCP tools

- **Status:** Accepted
- **Date:** 2026-06-07

## Context

Phase 4 adds the first real agent: a **single-turn Q&A** endpoint that answers a
natural-language question about **one account** by orchestrating the five
read-only MCP tools from Phase 3 (ADR-0007). This re-introduces real LLM calls
(absent since Phase 2 categorization).

The determinism-first rule (ADR-0004) is the heart of this phase. The split:

- **The LLM earns its place** for exactly two jobs — (a) *deciding* which tools
  to call, and (b) *phrasing* the natural-language answer.
- **Everything else is deterministic** — the data and all money math come from
  the Phase 3 tools (whose sums/net are pure `Money` folds); account existence,
  account scoping, the tool-call cap, request/response validation, and error
  mapping are plain code. The agent **never computes or estimates a figure
  itself**; every number in the answer comes from a tool output.

We verified the current Claude Agent SDK before designing (it evolves): the
package is **`@anthropic-ai/claude-agent-sdk`** (the former `@anthropic-ai/claude-code`),
entry point `query({ prompt, options })` returning an `AsyncGenerator<SDKMessage>`.
Three findings shaped the decisions below:

1. `query()` **runs as a subprocess** — the SDK bundles a per-platform native
   binary (on Linux/WSL `@anthropic-ai/claude-agent-sdk-linux-x64`). There is no
   in-process model and **no documented `ANTHROPIC_BASE_URL` redirect**, so the
   model **cannot be mocked inside `query()`**. This drives the test seam.
2. **`temperature` and `max_tokens` are not exposed** by the Agent SDK; cost/loop
   are bounded by `maxTurns` (and optional `maxBudgetUsd`). `effort` errors on
   Haiku 4.5, so it is not set. This does not weaken determinism — our guarantee
   is "tools are the only data source + their math is exact", not "temperature 0".
3. `options.env` **replaces** the subprocess env (it does not merge), so secrets
   must be passed as `{ ...process.env, KEY }` or the child loses `PATH`.

## Decision

**1. Use the Claude Agent SDK over the real MCP-over-stdio path.** The production
agent calls `query()` with `mcpServers: { ledgerlens: { command, args, env } }`,
which spawns `packages/mcp-server` as a subprocess and consumes its tools over the
MCP protocol (`mcp__ledgerlens__<tool>`). This is the point of having built the
MCP server in Phase 3 — the agent uses the real protocol, not an in-process
shortcut. The MCP child is launched as `node --import tsx <main.ts>` (path
resolved via a new `@ledger-lens/mcp-server` `./stdio` export), **without**
`--env-file`, so it uses only the `DATABASE_URL` we inject.

**2. Secrets, least privilege.** `ANTHROPIC_API_KEY` is passed in the **agent
subprocess** env (`options.env`, spread over `process.env`); `DATABASE_URL` is
passed **only** in the MCP child's `env`. The key is never logged and the MCP
child never receives a reason to read it. The app boots without a key — `query()`
is only called per request, and the adapter throws a clear error if the key is
missing at call time (mirroring the Phase 2 lazy-SDK pattern).

**3. Account-scoped endpoint with a code-enforced boundary.** `POST
/accounts/:accountId/ask { question }` answers about **that account only**. Three
layers, the first of which is the hard guarantee:

- **`canUseTool` deterministic guard (authoritative).** The SDK permission
  callback denies any tool call whose `input.accountId !== :accountId`, and denies
  `list_accounts` outright. It delegates to a pure `assertInScope(scopedId, tool,
  input)` function. `allowedTools` is deliberately **not** used to enforce scope —
  the docs define it as a no-prompt list, not a restriction, so it cannot be the
  boundary; `canUseTool` is. No tool call with a foreign `accountId` can reach the
  DB.
- **`disallowedTools: ["mcp__ledgerlens__list_accounts"]`** hides the one
  cross-account tool from the model entirely.
- **Prompt injection** states the agent answers about `:accountId` only and must
  pass it to every tool.

A deterministic `getAccountById` **404 pre-check** runs before any tokens are
spent on an unknown account.

**4. Determinism-first system prompt.** The prompt instructs: state a number only
if it appears in a tool result; never add/subtract/average/estimate; if no tool
provides the answer, say so plainly; always scope to `:accountId`. This is backed
by architecture — the `summarize_*` tools already do the sums/net, so the agent
*selects and reports*, never computes. Net flow is returned as a `{ direction,
amount }` pair (never a signed number); the prompt has the agent **relay** that
direction + amount ("net inflow/outflow of $X") rather than synthesize a sign, so
even the sign stays deterministic. Honest framing: prompt rules are best-effort;
the hard guarantee is the deterministic tools + the scope guard. Adherence quality
is measured by the Phase 5 evals, not asserted here.

**5. Model + cost, parametrized.** New env vars (separate from categorization):
`ANTHROPIC_AGENT_MODEL` (default `claude-haiku-4-5`), `ANTHROPIC_AGENT_MAX_TURNS`
(default `8`), `ANTHROPIC_AGENT_MAX_BUDGET_USD` (default `0.15`, a cheap
per-request guardrail). Haiku is the v1 default; a one-line env switch to Sonnet
if Phase 5 evals say it misses the bar.

**6. Response shape.** `200` with `{ answer, toolCalls: [{ tool, input }], meta: {
model, turns } }`. `toolCalls` (prefix stripped) is "show-your-work" transparency
and a Phase 5 eval signal. Cost/usage are **logged server-side, never returned**.

**7. Failure mapping** (a budget/complexity limit the user can act on is *not* a
server fault):

| Outcome | HTTP | Body |
|---|---|---|
| Normal answer (incl. "no tool has this info") | `200` | the agent's honest answer |
| `error_max_turns` / `error_max_budget_usd` | `200` | graceful "couldn't complete within the step limit; try narrowing the question" |
| `error_during_execution` | `502` | safe generic message (no internals) |
| unknown account | `404` | — |
| bad uuid / empty question | `400` | Zod issues |

**8. Mockable port + pure-helper seam (the testability decision).** Because the
model cannot be mocked inside `query()`, the seam is a **`QaAgent` port**
(symbol-token DI, like the Phase 2 client). Its logic is extracted into **pure,
unit-tested helpers** so only the live network call is offline-untestable:
`buildAskOptions(config, accountId, question)`, `extractAnswer(messages)`,
`extractToolCalls(messages)`, and `assertInScope(...)`. The production adapter
`AgentSdkQaAgent` is a thin wrapper that calls `query()` and these helpers.

**9. Tests use a scripted port + the real MCP protocol; no real API anywhere.**
- **Full-loop integration:** a `ScriptedQaAgent` (test double of the port) drives
  **canned decisions** through a **real `@modelcontextprotocol/sdk` client → the
  real `packages/mcp-server` over stdio → real tools → testcontainers Postgres**,
  reusing `assertInScope` and the cap. So `endpoint → service → scripted brain →
  REAL MCP protocol + tools → answer` runs deterministically. Its phrasing is a
  pure function of the **real** tool results, so the asserted numbers prove the
  full loop executed. (Bonus: first test to exercise the actual MCP protocol
  round-trip — Phase 3 only typechecked it.)
- **Unit (no DB, no API):** `assertInScope` (cross-account + `list_accounts`
  denied), `buildAskOptions` (scoping/env/model wiring), `extractAnswer` /
  `extractToolCalls` over synthetic `SDKMessage` fixtures (incl. `error_max_turns`
  → graceful).
- **Manual smoke** (`smoke:ask`): the **only** path that calls the real API — real
  Agent SDK + real MCP + seeded data, run by hand with the key. A `.ts` (not
  `.test.ts`/`.itest.ts`), excluded from `pnpm test` / `test:integration` / CI.
- **Honest caveat:** the literal `query()` invocation (model + subprocess) is
  covered only by the smoke — inherent to a subprocess agent SDK. Everything
  deterministic (scoping, cap handling, tools, DB, money, endpoint, answer/tool
  extraction) is in CI.

## Alternatives considered

- **Hand-rolled tool-use loop on `@anthropic-ai/sdk`** instead of the Agent SDK —
  would let the *same* loop run in prod and test with only `messages.create`
  mocked (no separate test adapter, fully CI-testable loop). Rejected: the project
  stack commits to the Agent SDK for the agent loop, and demonstrating Agent SDK +
  MCP-over-stdio is a portfolio goal. The port seam recovers most of the
  testability anyway.
- **Mock the model via `ANTHROPIC_BASE_URL`** pointing at a fake server —
  rejected: undocumented for the SDK subprocess and brittle.
- **`allowedTools` to enforce scope** — rejected: it is a no-prompt list, not a
  restriction; `canUseTool` is the real boundary.
- **In-process MCP server** (`createSdkMcpServer`) for the agent — rejected: the
  whole point is the real stdio protocol path. Kept as a possible perf option.
- **Calling the MCP tool handlers directly in the full-loop test** (à la Phase 3)
  — rejected in favour of the real client/stdio round-trip for protocol fidelity.

## Consequences

- **Positive:** a determinism-first agent where every figure is tool-sourced and
  exact; a code-enforced account boundary (`canUseTool`), not a prompt wish; cheap
  Haiku default with one-line escalation; clean port seam keeping the real
  LLM/agent injected and mockable; the deterministic surface fully covered in CI;
  the MCP protocol round-trip finally exercised.
- **Negative (accepted):** the live `query()` wiring is smoke-only (no in-process
  model mock for a subprocess SDK); the SDK pulls a platform binary (invoked only
  by the smoke, never CI); a small amount of test-only agent-loop code
  (`ScriptedQaAgent`).
- **Follow-ups:** Phase 5 evals score Haiku's decision/answer quality (and the
  Haiku→Sonnet switch); streamable-HTTP transport (Phase 7); multi-turn / session
  memory is explicitly out of scope (single-turn only).
