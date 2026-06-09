# 0004. Q&A agent over MCP tools

- **Status:** Accepted
- **Date:** 2026-06-07
- **Phase:** 4
- **Builds on:** spec 0003 (MCP tools), ADR-0004 (determinism-first), ADR-0005
  (money), ADR-0007 (MCP server), ADR-0008 (agent design).

## Summary / Goal

A single-turn Q&A endpoint — `POST /accounts/:accountId/ask { question }` — that
answers a natural-language question about **one account** by orchestrating the
five Phase 3 read-only MCP tools through the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`) over the real MCP-over-stdio protocol. First
real LLM use since Phase 2.

## Determinism-vs-LLM decision (central)

| Unit of work | Kind | Rationale |
|---|---|---|
| Decide which tools to call | **LLM** | Open-ended NL → tool selection; what the agent is for. |
| Phrase the natural-language answer | **LLM** | NL generation from tool outputs. |
| All numbers / money / dates in the answer | `deterministic` | Come verbatim from tool outputs (Phase 3 `Money` folds). The agent never computes. |
| Account existence (404) | `deterministic` | `getAccountById` pre-check before any tokens. |
| Account scoping (no foreign account) | `deterministic` | `canUseTool` guard denies `accountId` mismatch + `list_accounts`. |
| Tool-call cap | `deterministic` | `maxTurns`; `error_max_turns` → graceful 200. |
| Request/response validation | `deterministic` | Zod at the HTTP boundary. |

**Hard guarantee:** tools are the only data source and their math is exact;
prompt adherence is what the Phase 5 evals measure, not this phase.

## Endpoint contract

`POST /accounts/:accountId/ask`

- **Path** `accountId`: uuid (Zod → `400`). Unknown account → `404` (deterministic
  `getAccountById` pre-check, before spending tokens).
- **Body**: `{ question: string }` (non-empty, trimmed, bounded length; Zod → `400`).
- **`200` response**:
  ```jsonc
  {
    "answer": "Your May net was +$2,430.00 (in $2,500.00, out $70.00).",
    "toolCalls": [
      { "tool": "summarize_account",
        "input": { "accountId": "…", "dateFrom": "2026-05-01", "dateTo": "2026-05-31" } }
    ],
    "meta": { "model": "claude-haiku-4-5", "turns": 3 }
  }
  ```
  `tool` is the **prefix-stripped** domain name. Cost/usage are **logged
  server-side, never returned**.
- **Failure mapping** (ADR-0008 §7): `error_max_turns` / `error_max_budget_usd` →
  `200` graceful "couldn't complete within the step limit; try narrowing the
  question"; `error_during_execution` → `502` safe generic; "no tool has the info"
  → `200` honest answer.

## Agent ↔ MCP wiring

- `query({ prompt: question, options })` with:
  - `model` = `ANTHROPIC_AGENT_MODEL` (default `claude-haiku-4-5`);
  - `maxTurns` = `ANTHROPIC_AGENT_MAX_TURNS` (default `8`);
  - `maxBudgetUsd` = `ANTHROPIC_AGENT_MAX_BUDGET_USD` (default `0.15`);
  - `systemPrompt` = the determinism-first prompt with `:accountId` injected;
  - `mcpServers.ledgerlens = { command: node, args: ["--import","tsx", <main.ts>],
    env: { ...process.env, DATABASE_URL } }` — MCP child path resolved via the new
    `@ledger-lens/mcp-server` `./stdio` export; no `--env-file`;
  - `disallowedTools: ["mcp__ledgerlens__list_accounts"]`;
  - `permissionMode: 'default'` + `canUseTool` (the authoritative scope guard);
  - `env: { ...process.env }` so the agent subprocess sees `ANTHROPIC_API_KEY`
    (replaces, not merges — must spread).
- **Temperature/max_tokens are not exposed** by the Agent SDK (ADR-0008); not set.
  `effort` errors on Haiku; not set.

## System prompt (determinism-first)

`buildSystemPrompt(accountId)` instructs the model to: answer only about account
`accountId` and pass it to every tool; **state a figure only if it appears in a
tool result**; **never** add/subtract/average/estimate/guess a number; prefer the
`summarize_*` tools for totals/net rather than adding up transactions; if the
tools don't cover the question, say so plainly; report money exactly as the tools
return it.

**Money decimals (added Phase 5, ADR-0008 §4a):** the prompt directs the model to
report each money value's `decimal` field (the exact human amount, e.g.
`"7504.02"`) with the currency, and to **never** convert the minor-unit `amount`
itself — no ÷100, no decimal-point moves. The Phase 5 eval caught the agent doing
that placement itself and mis-rendering large figures; the real fix is the tools'
deterministic `decimal` (spec 0003), with this prompt rule as belt-and-suspenders.

## Module layout & the port seam

- **`apps/api/src/agent/`** (SDK-coupled only in the adapter):
  - `types.ts` — the `QaAgent` port (`ask({accountId, question}) → { answer,
    toolCalls }`), `QaAnswer`, `ToolCall`, `AgentConfig`, `AgentExecutionError`.
  - `scope.ts` — `resolveToolCall(scopedId, tool, input)` (pure; whitelist + inject
    the scoped accountId) + tool-name
    constants and the `mcp__ledgerlens__` prefix/strip helpers.
  - `prompt.ts` — `buildSystemPrompt(accountId)`.
  - `query.ts` — `buildAskOptions` / `extractAnswer` / `extractToolCalls` (pure)
    + `STEP_LIMIT_MESSAGE`.
  - `agent-sdk-client.ts` — `AgentSdkQaAgent` (live: `query()` + the pure helpers)
    + `DEFAULT_AGENT_MODEL` + env→config helpers.
  - `smoke.ts` — `smoke:ask` (real API; manual only).
- **`apps/api/src/http/ask/`**: `ask.dto.ts` (Zod request/response), `ask.tokens.ts`
  (`QA_AGENT` symbol), `ask.controller.ts`, `ask.service.ts` (404 pre-check →
  `agent.ask` → map `AgentExecutionError` to `502`), `ask.module.ts` (`useFactory`
  builds `AgentSdkQaAgent` lazily; tests override `QA_AGENT`).

The pure helpers make the adapter ~unit-testable offline; only the `query()` call
itself is smoke-only.

## Testing strategy (NO real API in any suite)

- **Unit (`*.test.ts`, no DB, no API, under `pnpm check`):**
  - `resolveToolCall` — allows the 4 tools, injecting the scoped `accountId`
    (`updatedInput`); a foreign or omitted `accountId` is overwritten;
    `list_accounts`/unknown denied.
  - `buildAskOptions` — `disallowedTools` hides `list_accounts`; `mcpServers.env`
    carries `DATABASE_URL`; model/maxTurns/maxBudgetUsd from config; system prompt
    contains `:accountId`; and `canUseTool`'s allow result carries `updatedInput`
    (the offline proxy for the SDK's smoke-only permission-result validation).
  - `extractAnswer` / `extractToolCalls` — over synthetic `SDKMessage` arrays:
    success → answer + turns + stripped tool calls; `error_max_turns` /
    `error_max_budget_usd` → `STEP_LIMIT_MESSAGE`; `error_during_execution` →
    `AgentExecutionError`.
- **Integration (`ask.e2e.itest.ts`, testcontainers, no API, under
  `test:integration`):** override `DATABASE` + `QA_AGENT` (with `ScriptedQaAgent`
  bound to a **real MCP client over stdio** to `packages/mcp-server` against the
  container). The scripted brain's phrasing is a pure function of the **real** tool
  results. Cases: a real full-loop answer (asserts a number that came through the
  real tool + DB + Money fold); **scope injection** (a decision passing a *foreign*
  or *omitted* `accountId` still runs against the scoped account — asserts the
  scoped account's number, not the other account's, the exact gap the smoke
  caught); `list_accounts` denied; unknown account → `404`; no-answer path → `200`;
  tool-call cap → graceful `200`.
- **Smoke (`smoke:ask`, manual, real API + real Agent SDK + real MCP + seeded
  data):** the only real-API path; excluded from CI.

## New dependencies

- `@anthropic-ai/claude-agent-sdk` (prod, `apps/api`) — pulls the platform native
  binary (invoked only by the smoke).
- `@modelcontextprotocol/sdk` (**dev**, `apps/api`) — the MCP client for the
  full-loop test.
- `@ledger-lens/mcp-server` gains a `./stdio` export (its `main.ts`) so the launch
  path resolves cleanly; commit `pnpm-lock.yaml`.

## Out of scope (later phases)

- Multi-turn / session memory (single-turn only).
- The Phase 5 eval harness that scores decision/answer quality and the
  Haiku→Sonnet switch.
- Streamable-HTTP transport (Phase 7).
