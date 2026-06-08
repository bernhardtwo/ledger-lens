# 0007. Domain MCP server

- **Status:** Accepted
- **Date:** 2026-06-07

## Context

Phase 3 exposes the persisted financial domain as a set of tools the Phase 4
agent can call to answer natural-language questions. The interesting engineering
is the boundary: the **tools must be deterministic** (data access + money
aggregation), and the LLM that orchestrates them arrives later. This phase ships
**no LLM** — no API key, no cost.

Constraints:

- Determinism-first (ADR-0004): every total/balance/by-category sum is computed by
  pure functions over the same-currency `Money` arithmetic (ADR-0005), never by an
  LLM and never as a float.
- Reuse the existing persistence layer and shared `Money` logic — no duplication.
- Use the MCP TypeScript SDK (`@modelcontextprotocol/sdk`) — not the Agent SDK or
  the Anthropic SDK (those are Phase 4 / out of scope here).
- The server must be consumable by the Phase 4 Agent SDK locally and by an
  eventual web/Azure deployment.

## Decision

**1. A small, READ-ONLY tool surface.** Five tools, each with a Zod input schema
and a typed (`structuredContent`) output: `list_accounts`, `get_account`,
`list_transactions` (filters: date range, category, direction, keyset
pagination), `summarize_spending_by_category` (debits per category over a range),
`summarize_account` (net cash flow over a range). **No mutating tools** in v1.
`raw_row` is **never** exposed to the agent.

**2. Money / aggregation is deterministic and reuses shared `Money`.** Every sum
is folded with the shared same-currency arithmetic seeded from the account's
currency (`zeroMoney` → `addMoney`; net via `compareMoney`/`subtractMoney`). The
**single-currency-account invariant holds by construction** — Phase 1's ingestion
currency guard rejects any file whose currency ≠ the account's, so a fold can
never hit a mixed currency. `net` is a `{ direction, amount }` pair (Money is a
non-negative magnitude, so a negative net is impossible). All money serialises as
`MoneyDTO` (string minor units + currency); **no `bigint`/float on the wire**.

**3. Aggregation is an in-process pure fold, not SQL.** Totals are folded in
TypeScript over the fetched rows using the shared `Money` value object. This keeps
the money boundary visible, reuses the audited arithmetic, and is unit-testable
without a DB. **SQL `SUM ... GROUP BY` is the later scale path** (when row counts
make TS folding wasteful) and would re-wrap the result in `Money`; it is a
performance optimisation, not a correctness change.

**4. stdio transport for v1; tool logic is transport-agnostic.** The server speaks
MCP over `StdioServerTransport` — the canonical local transport that the Phase 4
Agent SDK (and Claude Desktop) spawn as a subprocess. The tool handlers are plain
`(db, input) -> output` functions, decoupled from the transport, so a
**streamable-HTTP** transport can be added for Phase 7 / Azure without touching
them. It reads `DATABASE_URL` (server-side only) and reuses `createDatabase`.

**5. Packaging — the persistence layer was promoted to `@ledger-lens/db`.** The db
layer now has **two consumers** (the HTTP API and this MCP server). A package
depending on an app would be a backwards dependency (apps are the leaves of the
graph; packages are the shared libs beneath them). So `apps/api/src/db` was
extracted into a `@ledger-lens/db` package in a prior, behaviour-preserving
refactor. Target graph: `@ledger-lens/shared` <- `@ledger-lens/db` <- { `apps/api`,
`packages/mcp-server` }. The MCP server lives in `packages/mcp-server` and depends
only on `@ledger-lens/db` + `@ledger-lens/shared` — no NestJS, no Anthropic SDK.

**6. Tests call the tool handlers in-process.** Integration tests run against a
testcontainers Postgres with seeded + persisted data and call the handlers
directly (no MCP client, transport, agent, LLM, or network). The pure aggregation
folds are unit-tested over hand-built rows with zero/empty/edge cases.

## Alternatives considered

- **Mutating / write tools** — rejected for v1: the agent should read and reason,
  not mutate; ingestion/categorisation already own writes via the HTTP API.
- **A `get_transaction` audit tool exposing `raw_row`** — rejected: `list_transactions`
  covers detail, and the raw bank row is PII the agent must never see.
- **SQL aggregation now** — rejected for v1 in favour of the shared-`Money` fold
  (boundary visibility + reuse + unit-testability); kept as the scale path.
- **MCP server as a module inside `apps/api`, or `packages/mcp-server` depending on
  `apps/api`** — rejected: the first muddies the app with a second entrypoint over
  the same db; the second is a backwards (package→app) dependency. Promoting the db
  to a package is the clean fix once it has two consumers.
- **HTTP/SSE transport for v1** — deferred: stdio is simplest for the local agent
  and tests bypass the transport entirely; streamable-HTTP lands with deployment.

## Consequences

- **Positive:** the agent gets a deterministic, validated, read-only view of the
  domain; money stays exact and same-currency by construction; zero LLM cost this
  phase; the clean `shared <- db <- {api, mcp}` graph; tools are testable without
  an agent.
- **Negative (accepted):** in-process folds load rows into memory (fine for
  synthetic data; SQL aggregation is the documented scale path); one more package
  to maintain; stdio-only until Phase 7 adds a remote transport.
- **Follow-ups:** streamable-HTTP transport (Phase 7); SQL aggregation if data
  grows; possibly a net-per-category tool; wire these tools into the Phase 4 agent.
