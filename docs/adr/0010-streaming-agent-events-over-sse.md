# 0010. Stream agent events to the browser over SSE

- **Status:** Accepted
- **Date:** 2026-06-13

## Context

Phase 6 builds the chat UI (spec 0006) on top of the Phase 4 Q&A agent (ADR-0008,
spec 0004). The headline agentic demonstration is **progressive "show your work"**:
the user watches the agent pick tools and then resolve an answer, live, rather than
staring at a spinner until a single JSON payload lands. This ADR records one
already-approved decision — **stream the agent's intermediate events to the browser
over Server-Sent Events** — and is the authoritative home of the SSE transport and
the event/wire contract. Spec 0006 references this ADR and must not redefine the
event union.

Three verified facts shape the design:

1. **The substrate already exists.** The Claude Agent SDK `query()` is an async
   generator; the production adapter (`apps/api/src/agent/agent-sdk-client.ts:59`)
   already consumes it with `for await (const message of query(...))` — it just
   **buffers** every `SDKMessage` and discards the intermediate ones. The assistant
   `tool_use` blocks and the final `result` therefore already arrive incrementally;
   we are exposing what we throw away, not building a new loop.

2. **There is one classifier, and it must stay one.** The pure helpers
   `extractAnswer` / `extractToolCalls` / `totalCostUsd` (`apps/api/src/agent/query.ts`)
   reduce `SDKMessage[]` → answer / toolCalls / turns / cost; tool calls are the
   main-thread assistant `tool_use` blocks (`parent_tool_use_id === null`),
   domain-prefix-stripped. The hard maintainer constraint: **one source of truth for
   `SDKMessage → {toolCalls, answer, meta}`** — `/ask` and the new stream must not
   drift.

3. **The eval calls the agent, not HTTP.** The Phase 5 harness invokes
   `agent.ask()` directly (`AgentSdkRunner` → `AgentSdkQaAgent`,
   `apps/api/src/evals/agent-runner.ts:21`), never the endpoint. So the precise
   invariant this ADR must protect is: **`AgentSdkQaAgent.ask()` returns an identical
   `QaAnswer`** — the existing 47 integration tests and the eval stay green.

This is a portfolio project, so the bar is "demonstrate the agentic UX honestly and
keep the determinism guarantee intact", not "ship every streaming feature".

## Decision

**1. An additive SSE endpoint; `/ask` is untouched.** Add
`POST /accounts/:accountId/ask/stream`, consumed on the client via `fetch()` +
`ReadableStream` (not native `EventSource`, which is GET-only and cannot carry the
up-to-1000-char question body cleanly). `POST /ask` (JSON) stays **unchanged** for
the eval and any non-stream caller. The same deterministic `getAccountById` **404
pre-check** runs *before* the stream opens, mirroring ADR-0008 §3 — no tokens are
spent on an unknown account.

**2. A `StreamingQaAgent` port seam.** Add `askStream(input): AsyncIterable<AgentEvent>`
alongside the existing `QaAgent.ask` (same symbol-token DI as ADR-0008 §8). The
production adapter iterates the **same** `query()` loop and yields events as they
arrive.

**3. Single source of truth — `ask()` is a fold over `askStream()`.** The existing
pure helpers stay authoritative. A pure per-message classifier emits the live
events: `tool_call` and `answer` / `done` reuse the **same** predicates as the
helpers (main-thread assistant `tool_use`; the `result` subtype), while
`tool_result` is a *new* predicate over the agent's `user` / `tool_result`
messages — which the helpers never inspect — with `ok = !is_error`. The
**terminal** event payload (answer / toolCalls / meta) is computed by those exact
helpers, so it equals `ask()`'s `QaAnswer` **by construction**. `ask()` is
therefore expressed as a fold over `askStream()` — low-risk precisely because the
terminal payload *is* the helper output. **The fold maps a terminal `error` event
back to a thrown `AgentExecutionError`** — today's `ask()` *throws* on
`error_during_execution` / no-result (`query.ts:128,138`), so the 502 path is
preserved exactly, while the SSE transport serialises that same condition as an
`error` frame. Documented fallback if the fold proves awkward: both `ask` and
`askStream` call the identical pure mapper. Either way `AgentSdkQaAgent.ask()` is
output-invariant. A **parity unit test** asserts `ask()` === fold of `askStream()`
over a scripted `SDKMessage[]` across all four terminal shapes —
success-with-text, success-with-empty-text, graceful step-limit
(`error_max_turns` / `error_max_budget_usd`), and `error_during_execution` /
no-result (the fold **re-throws**) — guarding the no-drift constraint offline.

**4. Event contract (authoritative).** A Zod **discriminated union `AgentEvent`** in
`@ledger-lens/shared`, so server and client share the identical symbol. Each event is
one SSE frame (`data: <json>\n\n`):

| Event | Payload | Notes |
|---|---|---|
| `tool_call` | `{ type: "tool_call", tool: string, input: Record<string,unknown> }` | main-thread assistant `tool_use`, prefix-stripped |
| `tool_result` | `{ type: "tool_result", tool: string, ok: boolean }` | from the agent's `user` / `tool_result` message; `ok = !is_error` (a tool *can* fault). **The flag + tool name only — never tool outputs or any figure.** |
| `answer` | `{ type: "answer", text: string }` | the final answer text |
| `done` | `{ type: "done", meta: { model, turns }, stopReason: "ok" \| "step_limit" }` | terminal success. `stopReason` is derived server-side from the SDK result subtype (`error_max_turns` / `error_max_budget_usd` → `"step_limit"`, else `"ok"`); the graceful step-limit still carries `STEP_LIMIT_MESSAGE` as the `answer`, mirroring `/ask`'s graceful `200`. Lets the UI flag the degraded case with **no** client-side cap and **no** message pattern-matching. |
| `error` | `{ type: "error", code: "agent_error", message: string }` | SDK `error_during_execution` / transport faults; mirrors `/ask`'s `502` |

SSE framing: one JSON object per `data:` line; an optional `event:` name per frame;
an optional heartbeat comment (`: ping\n\n`) to keep idle connections alive through
proxies.

`stopReason` lives on the SSE `done` event **only**; `POST /ask` (JSON) stays
**frozen** — the `ask()` fold projects the terminal payload down to the unchanged
`QaAnswer` / `AskResponse`, dropping both `stopReason` and `totalCostUsd`. The
shared classifier is the single source of truth; the two transports expose
*subsets* of it (`/ask` omits `stopReason`) and never contradict on
answer / toolCalls / meta. Consumers must narrow `tool_call.input` (typed
`Record<string, unknown>`) before reading specific keys — under
`noUncheckedIndexedAccess` an index access is not assumed present.

**5. Determinism-first holds (ADR-0004).** Numbers reach the client **only** via the
final `answer` text (which quotes the tools' deterministic `decimal`, ADR-0007 §2a /
ADR-0008 §4a). `tool_result` carries `ok` and the tool name — **no figures**. The
guarantee is identical to `/ask`: SSE relays the agent's events *sooner*, it computes
nothing. (The fold also computes `totalCostUsd` (`query.ts:167`), but it is dropped
before serialising `done` — cost is server-log-only per ADR-0008 §6, never on the
wire.)

**6. Transport / CORS.** The browser calls same-origin Next, which proxies to the API
(spec 0006), so **no API CORS change**. This carries one empirical risk that is a
gated step, not an assumption: **SSE must stream through the Next proxy un-buffered
under `next dev` (verified in Step 3).** Documented fallback if it buffers: enable
CORS + a direct browser→API connection, or a Next Route Handler that pipes the stream
with buffering explicitly disabled.

## Boundary — explicitly deferred

Token-level partial-text deltas (an `answer_delta` event via the SDK's
partial-messages option) are **out of this ADR**. v1 streams at **turn granularity**
(tool-calls + final answer), not per token. Rationale: marginal UX value for a fast
Haiku agent (`maxTurns` 8, sub-budget) versus real delta-reassembly complexity.
Revisit in a later phase.

## Alternatives considered

- **Non-streaming first** (consume `/ask`, show a thinking state, then reveal the full
  `toolCalls` + answer at once) — lower footprint, zero backend touch. Rejected for
  v1: it misses the headline progressive agentic demo, while the streaming substrate
  already exists (fact 1) at near-zero classification cost.
- **Token-level streaming now** — rejected: complexity outweighs value at this phase
  (see Boundary).
- **WebSocket / bidirectional transport** — rejected: over-engineered for a one-shot
  Q&A with no client→server mid-stream messaging.
- **Native `EventSource` (GET)** — rejected: GET-only, cannot carry the question body
  cleanly; `fetch()` + `ReadableStream` reads the identical SSE wire format from a
  POST.
- **Returning tool outputs in `tool_result`** — rejected: it would put figures on the
  wire outside the answer, weakening the determinism guarantee (§5) and diverging from
  `/ask`'s contract.

## Consequences

- **Positive:** live "show your work" UX — the headline agentic demonstration; a
  single classification source of truth; `AgentSdkQaAgent.ask()` invariant ⇒ the eval
  and the 47 integration tests are **provably** unchanged (guarded by the parity
  test); the pure mapper and the client-side reducer are both unit-testable offline
  with no real API.
- **Negative (accepted):** one new endpoint + port method + event contract to
  maintain; an SSE-through-proxy buffering risk (mitigated by the Step 3 verification
  gate and a documented fallback); the client uses `fetch`-stream parsing with **no
  native auto-reconnect** (acceptable for a single-shot Q&A); the `AgentEvent` union
  becomes a shared contract that must stay in sync with the helpers (the parity test
  guards this).
- **Follow-ups:** token-level `answer_delta` streaming in a later phase; verify the
  Next-proxy buffering behaviour (Step 3) and adopt the fallback only if it buffers.
