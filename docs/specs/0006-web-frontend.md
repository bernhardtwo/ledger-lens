# 0006. Web frontend (Next.js)

- **Status:** Accepted
- **Date:** 2026-06-13
- **Phase:** 6
- **Builds on:** spec 0001 (domain/DTOs), spec 0004 (Q&A agent + `POST /ask`),
  ADR-0002 (pnpm monorepo), ADR-0004 (determinism-first), ADR-0005 (money),
  ADR-0008 (agent design), and **ADR-0010** (this phase's SSE-streaming
  decision — the authoritative home of the wire/event contract; this spec
  summarises and links it, and does **not** redefine the event union).

## Summary / Goal

A lean Next.js (App Router) web app that makes the existing API demonstrable end
to end: **pick a demo account → upload a CSV statement → see the resulting
transactions → categorize → chat with the agent**, with the agent's tool-calls
and final answer revealed **progressively** over SSE. The client reuses the
`@ledger-lens/shared` DTOs verbatim, **never computes money or totals**, and the
backend gets two *behavioural* changes — the new streaming ask endpoint and a
tiny read-only `GET /accounts` — plus a no-op prep refactor that lifts the
response envelopes into `@ledger-lens/shared`. CORS is avoided entirely via a
same-origin Next rewrites proxy. This is the first user-facing surface; it adds
no new LLM use — the only model in the system remains the Phase 4 agent, behind
the API, unchanged.

## Determinism-vs-LLM decision (central)

| Unit of work | Kind | Rationale |
|---|---|---|
| Render money / amounts | `deterministic` | Shared `moneyDtoToDecimalString(dto)`; the client **never** does `Number()` / `÷100` / decimal-point moves. |
| Sign + colour of an amount | `deterministic` | Derived from `direction` (debit = out, credit = in); the magnitude is always non-negative — no negative value is ever rendered. |
| Totals / nets shown in chat | `deterministic` | Come **verbatim** from the agent's answer text, which quotes the tools' `decimal`. The UI never sums or re-derives a figure. |
| Tool-call / answer / meta classification | `deterministic` | One shared pure mapper over `SDKMessage`; `POST /ask` is a fold over `askStream`, so JSON and SSE cannot diverge on answer/toolCalls/meta. (The SSE `done` additionally surfaces a server-derived `stopReason`; `/ask` omits it to stay frozen — the fold drops it.) |
| Keyset cursor handling | `deterministic` | `nextCursor` is opaque and forward-only; the client appends pages and stops when it is `null`. |
| Request / response validation | `deterministic` | Shared Zod schemas — the **identical symbol** parsed on the server and on the client (single source of truth). |
| Chat state from the event stream | `deterministic` | Pure reducer `(AgentEvent[]) → ChatState`; the key tested seam. |

**Hard guarantee:** the frontend is a thin, deterministic presentation of an
already-deterministic API. The only LLM in the system stays behind `/ask` and
`/ask/stream` (the Phase 4 agent), untouched this phase. Limitations and
refusals are **not** pattern-matched in the UI — they arrive as ordinary answer
text and are rendered as-is.

## Prep refactor (first commit, before any web code)

A single isolated commit — `refactor(shared): lift API response envelopes into
shared` — lifts the API's response envelopes into `@ledger-lens/shared` so the
NestJS response-validation `.parse()` calls and the web client import the
**identical** symbol (no drift). No behaviour changes.

New / moved schemas land in `packages/shared/src/api/*.ts`, re-exported from
`packages/shared/src/index.ts`:

1. `AccountsResponseSchema` (**new**) — `{ accounts: AccountSchema[] }`.
2. `TransactionListItemResponseSchema`
   (`= TransactionListItemSchema.extend({ category: CategorySchema.nullable() })`)
   + `TransactionsPageResponseSchema` (`{ items, nextCursor }`).
3. `ToolCallSchema` + `AskResponseSchema` (`{ answer, toolCalls, meta: { model, turns } }`) — **moved** from `apps/api/src/http/ask/ask.dto.ts` (they already exist there); `AskRequestSchema` stays in the API.
4. `StatementIngestResponseSchema` (moved from spec 0001's `*.dto.ts`).
5. `CategorizeResponseSchema`.

The `AgentEvent` Zod union also lives in `packages/shared/src/api/` (server and
client share it); its **authoritative definition is ADR-0010** — this spec does
not restate the member shapes.

The existing API DTO files (`apps/api/src/http/*/*.dto.ts`) **import** the lifted
symbols instead of declaring them. Request-side validators
(`AccountIdSchema`, `ListQuerySchema`, the `{ question }` body) **may stay** in
the API; lifting them is optional and out of scope.

**Constraints (all must hold before any web code is written):** API behaviour is
byte-identical; **all 186 unit + 47 integration tests stay green**; respect
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.

## Streaming integration (summary; wire contract defers to ADR-0010)

- **New port** `StreamingQaAgent.askStream(input): AsyncIterable<AgentEvent>`
  alongside the existing `QaAgent.ask` in `apps/api/src/agent/types.ts`.
- **One source of truth (hard constraint).** The existing pure helpers
  `extractAnswer` / `extractToolCalls` / `totalCostUsd`
  (`apps/api/src/agent/query.ts`) over `SDKMessage[]` stay authoritative.
  `askStream` emits live per-message events via a **pure classifier**: `tool_call`
  and `answer` / `done` reuse the **same predicates** as the helpers (main-thread
  assistant `tool_use`; the `result` subtype), while `tool_result` is a *new*
  predicate over the agent's `user` / `tool_result` messages — which the helpers
  never inspect — with `ok = !is_error`. The terminal event payload
  (answer / toolCalls / meta) is produced by **those exact helpers** — so it
  equals `ask()`'s `QaAnswer` by construction.
- **`ask()` becomes a fold over `askStream()`.** This is low-risk *precisely
  because* the terminal payload **is** the helper output. The fold maps a terminal
  `error` event back to a thrown `AgentExecutionError` — today's `ask()` *throws*
  on `error_during_execution` / no-result (`query.ts:128,138`), so the 502 path is
  preserved while the SSE transport serialises that same condition as an `error`
  frame. Documented fallback if any risk surfaces: both `ask` and `askStream` call
  the identical pure mapper. Either way `AgentSdkQaAgent.ask()`'s output is
  **invariant**.
- **Eval / integration parity (state exactly).** The eval harness calls
  `agent.ask()` **directly** (not HTTP `/ask`) via `AgentSdkRunner` →
  `AgentSdkQaAgent` (`apps/api/src/evals/agent-runner.ts:21`). The parity
  invariant is therefore precisely: **`AgentSdkQaAgent.ask()` returns an
  identical `QaAnswer` after the refactor.** A new **parity unit test** asserts
  `ask()` deep-equals the fold of `askStream()` over a scripted `SDKMessage[]`
  across all terminal shapes — success-with-text, success-with-empty-text,
  graceful step-limit, and `error_during_execution` / no-result (the fold
  **re-throws**) — so the eval and the 47 integration tests are provably
  unchanged because they ride on that invariant.
- **HTTP — new SSE endpoint** `POST /accounts/:accountId/ask/stream`, consumed
  via `fetch()` + `ReadableStream` (**not** native `EventSource`: that is
  GET-only and cannot carry the up-to-1000-char question body). The **same
  deterministic 404 pre-check** runs **before** the stream is opened. `POST /ask`
  (JSON) is kept unchanged. `tool_result` events carry **`{ ok }` only** — raw
  numbers appear **only** in the final answer (matching `/ask`, which never
  returned tool outputs).
- **Test double.** `ScriptedQaAgent` is extended to implement `askStream` too.
  Existing `/ask` integration tests are untouched (they call `ask`).

## Decisions (each with a one-line rationale; all approved)

> Decision 1 — streaming — is recorded in *Streaming integration* above and
> ADR-0010; the numbering below preserves the maintainer's original 1–9 framing
> (where 1 = streaming).

**2 — Next.js structure.** `apps/web` is a workspace member depending **only** on
`@ledger-lens/shared` (`workspace:*`) plus `next` / `react` / `react-dom` —
**never** `@ledger-lens/db` (db pulls drizzle/postgres/node-only code into the
browser bundle). `@ledger-lens/shared` ships **raw TS** (its `package.json`
exports `./src/index.ts`) and is browser-safe (no `node:` / `process` / `fs`
under `packages/shared/src`; sole dependency is `zod`), so `next.config` **must**
set `transpilePackages: ["@ledger-lens/shared"]`. `next.config` rewrites
`/api/* → ${API_BASE_URL}` using a **server-only** env var (**not**
`NEXT_PUBLIC_`). App Router; **mostly Client Components** — the interactive
surfaces talk to an external API, not a DB, so there is little for RSC under
determinism-first; Server Components are used only for the static layout/shell.
`tsconfig` extends the root strict config. Idiomatic Next with light feature
folders, **not** full FSD.

```
apps/web/
  app/
    layout.tsx                       # static shell (Server Component)
    page.tsx                         # account picker (landing)
    accounts/[accountId]/page.tsx    # the working surface (upload + txns + chat)
  features/
    account-picker/                  # GET /accounts → list, deep-link to a segment
    upload/                          # multipart POST /statements + rejected-rows UX
    transactions/                    # keyset list + <Money> rendering
    chat/                            # SSE stream → reducer → message list
  components/                        # lean hand-rolled primitives
  lib/
    api.ts                           # fetch wrapper; shared-Zod validation + error normalize
    contracts.ts                     # re-export of the shared API schemas used here
    money.tsx                        # <Money> + the deterministic sign/colour rule
    chat-stream.ts                   # pure SSE frame parser + pure (AgentEvent[]) → ChatState reducer
```

**3 — Chat rendering.** A message list; an assistant turn renders as **live
tool-call rows** (from `tool_call` events — tool name plus key inputs such as the
date range or category) → **final answer** → a **muted footer** (`meta.model`,
`meta.turns`). The tool trail is collapsible ("show your work"). Limitation /
refusal is **not pattern-matched**: honest limitations arrive as ordinary
`answer` text (e.g. `STEP_LIMIT_MESSAGE`, "the tools don't cover that") and are
rendered as-is, possibly with an empty/short tool trail; the degraded
*step-limit* case is flagged from the `done` event's **`stopReason: "step_limit"`**
(derived server-side from the SDK result subtype — see ADR-0010), never by reading
a client-side cap or pattern-matching `STEP_LIMIT_MESSAGE`. A `502` or network
error yields an error state with a retry. The pure reducer
`(AgentEvent[]) → ChatState` is the key tested seam.

**4 — Transactions view.** Columns: **date** (`transactionDate`; `postedDate`
secondary), **description**, **category badge** ("Uncategorized" when `category`
is `null`), **direction** (in / out), **amount** (`<Money>` via the shared helper;
sign and colour from `direction`, **never** a negative value). Pagination is
**keyset "Load more"** — append the next page using `nextCursor`, stop when it is
`null` — **not** numbered pages (the cursor is opaque and forward-only). The list
**resets** on account switch, after a successful upload, and after categorize.

**5 — Upload + rejected-rows UX.** A CSV file input → multipart field `file` →
`POST /accounts/:accountId/statements`. The success panel shows **inserted N** /
**skipped N** (idempotent duplicates) / an **expandable rejected list**
(`row` + `reason`), and **distinguishes 201 created from 200 "already imported,
no new rows"** (`statementId` is `null` on the no-op). Errors map to the verified
codes (see below): **413** file-too-large, **415** non-CSV, **422** with its
three sub-reasons (currency-mismatch / `unknown-profile`, surfacing the
`signature` field, / too-many-rejected), **400** otherwise. The client normalizer
handles **both** error-body shapes.

**6 — Account picker (no auth).** Add a tiny read-only **`GET /accounts`**: a new
`AccountsController` + service over the existing `listAccounts(db)`
(`packages/db/src/accounts.repository.ts:18`, ordered by name), mapping each
row's `currencyCode → currency`, validated through the shared
`AccountsResponseSchema`. The picker consumes this so it reflects **real DB
state** with no duplicated seed identity. (There is currently **no**
`GET /accounts` HTTP endpoint.) Selection is encoded in the route segment
`/accounts/[accountId]` (deep-linkable). Loading / empty / error states included.

**7 — Styling.** Lean **Tailwind + hand-rolled primitives** (**no** shadcn /
Radix), but **intentional, portfolio-grade visual design — not a default
scaffold**: a cohesive palette (neutrals + 1–2 accents + semantic
success/warning/danger for the ingest and limit states), a real typographic
hierarchy (display / heading / body plus a **mono** face for figures and
amounts), and a considered spacing rhythm. One sans family + one mono. The token
set is small and declared once.

**8 — Dev orchestration / CORS / base URL.** A **same-origin Next rewrites
proxy** (`/api/*`): the browser only ever calls Next, so **no API CORS change**
is needed and `API_BASE_URL` stays server-only. **Verification gate (must be
empirically confirmed at build time, Step 3):** that **SSE streams through the
Next proxy *un-buffered* under `next dev`**. Documented fallback if it buffers:
enable CORS + a direct browser→API connection, **or** a Next Route Handler that
pipes the stream with buffering disabled. The root `dev` script runs web + api in
parallel (cross-platform; honour the WSL-toolchain note in CLAUDE.md / project
memory), with Postgres brought up first via `docker compose`. Per-surface
loading / empty / error states, plus an **"API unreachable"** banner.

**9 — Frontend testing (proportional).** Vitest + React Testing Library (jsdom).
See the testing section below. A single manual Playwright happy-path smoke is
**optional and explicitly outside** the automated suite (mirrors the API's
`smoke:*` manual pattern). **No** full E2E matrix.

## Verified API surface (the client codes against these exactly)

- **`GET /accounts/:accountId/transactions?limit&cursor`** — `limit` 1..200,
  default 50; `cursor` opaque → `{ items: TransactionListItem (+ category nullable)[], nextCursor: string | null }`.
- **`POST /accounts/:accountId/statements`** (multipart, field `file`) →
  `{ statementId: uuid | null, profileId, inserted, skipped, rejected: { row, reason }[] }`;
  **201 when `statementId` is non-null, 200 on an idempotent no-op.**
- **`POST /accounts/:accountId/categorize`** →
  `{ totalUncategorized, categorized, uncategorized, failed }` (200, idempotent).
- **`POST /accounts/:accountId/ask`** `{ question: string (1..1000) }` →
  `{ answer, toolCalls: { tool, input }[], meta: { model, turns } }` (200 incl.
  graceful step-limit and an honest "can't"; **404** unknown account; **502**
  agent fault).
- **`POST /accounts/:accountId/ask/stream`** (**new**) — SSE; same `{ question }`
  body and the same deterministic 404 pre-check.

**Upload error codes (verified, `apps/api/src/http/common/http-exceptions.filter.ts`
+ e2e tests):** **413** `file-too-large`; **415** non-CSV; **422** =
currency-mismatch / `unknown-profile` (surfaces a `signature` field) /
`too-many-rejected`; **400** empty-file / not-utf8 / missing-file / bad-uuid /
malformed-cursor. **Two error-body shapes exist and the normalizer must handle
both:** `{ error, message, signature? }` (domain errors) and
`{ statusCode, message, error? }` (Nest `HttpException`).

**API bootstrap (`apps/api/src/http/main.ts`):** no `enableCors()`, no global
prefix, default port `3001`. **Seed accounts (`packages/db/src/seed.ts`):**
`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` = Everyday Checking / Bank A / USD;
`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` = Cuenta Nómina / Banco B / EUR.

## Interfaces (key client seams)

```ts
// lib/money.tsx — sign + colour are deterministic from direction; magnitude is
// always non-negative (spec 0001). Renders via the shared decimal helper only.
function Money(props: { amount: MoneyDTO; direction: Direction }): JSX.Element;
// internally: moneyDtoToDecimalString(props.amount)  // never Number()/÷100

// lib/chat-stream.ts — both pure, both unit-tested in isolation.
function parseSseFrames(chunk: string, carry: string): { events: AgentEvent[]; carry: string };
function chatReducer(state: ChatState, event: AgentEvent): ChatState;
//  tool_call  → append a tool-call row (tool + key inputs; narrow `input` before
//               reading keys — it is Record<string, unknown> under strict mode)
//  tool_result→ mark the matching row ok/!ok (carries { ok } only)
//  answer     → set the turn's final text (rendered as-is, even if a refusal)
//  done       → attach meta { model, turns }; flag step-limit iff stopReason === 'step_limit'
//  error      → error state (502 / network), retry available

// lib/api.ts — every response parsed through the IDENTICAL shared schema;
// both error-body shapes normalized to one ApiError before it reaches the UI.
async function listAccounts(): Promise<Account[]>;                 // AccountsResponseSchema
async function listTransactions(accountId, cursor?): Promise<TransactionsPage>;
async function uploadStatement(accountId, file): Promise<StatementIngestResult>;
async function categorize(accountId): Promise<CategorizeResult>;
function askStream(accountId, question): AsyncIterable<AgentEvent>; // fetch + ReadableStream
```

The `AgentEvent` union, the SSE framing, and the `tool_result: { ok }` shape are
**defined in ADR-0010** and imported from `@ledger-lens/shared`; this spec does
not restate them.

## Module layout & new files (sketch)

- **`packages/shared/src/api/`** — the new response envelopes (decisions above)
  + the `AgentEvent` Zod union (authoritative shape in ADR-0010), re-exported
  from `src/index.ts`.
- **`apps/api`:**
  - `agent/stream.ts` — the pure `SDKMessage → AgentEvent` classifier (built from
    the existing predicates) + the terminal payload via the existing
    `extractAnswer` / `extractToolCalls` / `totalCostUsd`.
  - `agent/types.ts` — `+ StreamingQaAgent` port.
  - `http/ask/` — the SSE controller/handler (`POST …/ask/stream`); the scripted
    double updated to implement `askStream`; `POST /ask` untouched.
  - `http/accounts/` — **new** controller + service + module for `GET /accounts`.
- **`apps/web`:** the structure under Decision 2.

## Testing strategy (proportional — test-heavy but proportionate)

Vitest + React Testing Library (jsdom). `apps/web` is wired into the workspace
test run (under `pnpm check`).

- **`<Money>`** — USD (exp 2) and EUR (exp 2) exponents, large figures beyond
  `2^53`, exact decimals (**guards determinism**); colour/sign driven by
  `direction`; never emits a negative magnitude.
- **Transactions table** — append-on-"Load more" (the appended page extends the
  list; stops when `nextCursor === null`); empty state; null-`category` →
  "Uncategorized" badge.
- **Pure chat reducer `(AgentEvent[]) → ChatState`** — tool-call rows assembled in
  order; `tool_result { ok }` toggles the row (incl. `ok: false`); a **limitation
  answer** rendered as ordinary text; an **error event** → error state; `done`
  attaches `meta { model, turns }` and flags the step-limit note iff
  `stopReason === "step_limit"` (covers the budget-abort case, which need not
  reach the turn cap).
- **Pure SSE frame parser** — partial frames carried across chunks; multiple
  events in one chunk; trailing/empty lines ignored.
- **API client** — shared-schema validation accepts a valid envelope and rejects
  a malformed one; error normalization maps **413 / 415 / 422 / 404 / 502** and
  **both** body shapes (incl. surfacing the 422 `signature`) to one `ApiError`.
- **`SDKMessage` → `AgentEvent` classifier** (in `apps/api`) — a `user` /
  `tool_result` message yields `tool_result { ok }` (both the success and the
  `is_error` → `ok: false` cases — a shape the current `query.test.ts` fixtures
  don't cover); `tool_call` ordering preserved; the `result` subtype drives
  `done.stopReason`.
- **Agent fold parity** (in `apps/api`) — `AgentSdkQaAgent.ask()` deep-equals the
  fold of `askStream()` over a scripted `SDKMessage[]` (the invariant that keeps
  the eval and the 47 integration tests honest).

**No `packages/evals` work this phase.** No unit here is `llm-assisted` or
`agentic` — the only model in the system is the unchanged Phase 4 agent behind
the API, already covered by the Phase 5 golden set. The frontend adds no new
LLM behaviour to evaluate, so the eval harness is untouched; the agent-fold
parity test is what protects the existing evals.

A single manual **Playwright** happy-path smoke (pick account → upload → list →
categorize → ask) is **optional and outside** the automated suite (mirrors the
API's manual `smoke:*` pattern). **No** full E2E/browser matrix.

## Out of scope (later phases)

- Token-level partial-text deltas (`answer_delta` via the SDK's partial-messages
  option) — an explicit ADR-0010 boundary.
- Auth / multi-user / account CRUD.
- PDF upload (the API is CSV-only).
- Multi-turn / session memory (the API is single-turn; chat history is
  client-ephemeral, never persisted).
- Category editing, reconciliation UI, charts/visualisation, export, transaction
  drill-down / `rawRow`.
- Full E2E / browser matrix.
- Deployment (Phase 7).

## Risks & verification gates

- **SSE buffering through the Next proxy** — the first-class build-time gate
  (Decision 8, Step 3); proceed only once streaming is confirmed un-buffered
  under `next dev`, else take the documented fallback.
- **Transpiling shared raw-TS under Next** — ESM + type resolution via
  `transpilePackages: ["@ledger-lens/shared"]`; verify the browser bundle builds
  and resolves the shared types.
- **Enforce the web→db import ban** — `apps/web` may import **only**
  `@ledger-lens/shared`; importing `@ledger-lens/db` would drag node-only code
  into the bundle.
- **Prep refactor must be byte-identical** — all 186 unit + 47 integration tests
  stay green and API responses unchanged before any web code is written.

## Resolved during review

1. **`AgentEvent` union finalisation** lives in **ADR-0010** (now Accepted); the
   union and its SSE framing are settled there. If a later change adds or renames a
   member, the shared schema and the chat reducer follow it — this spec does not
   pre-commit the shape.
2. **Step-limit signalling — resolved (ratified).** The client cannot use
   `turns === cap` (no cap client-side; a budget abort need not reach the cap), and
   pattern-matching `STEP_LIMIT_MESSAGE` is disallowed. **Decision:** the SSE `done`
   event carries a server-derived `stopReason: "ok" | "step_limit"`, and the UI
   flags the degraded case from that. This keeps `POST /ask` **frozen** (the field
   is SSE-only; the `ask()` fold drops it), honouring the "`/ask` unchanged"
   constraint — one shared classifier, two transports exposing subsets. Alternatives
   considered and rejected: (a) drop the info note entirely and rely on the honest
   `STEP_LIMIT_MESSAGE` text; (b) add `stopReason` to `/ask` `meta` too for full
   JSON/SSE lockstep, at the cost of `/ask` no longer being byte-identical — which
   would dilute the eval-protecting invariant for a field nothing consumes.
