# 0003. Domain MCP server

- **Status:** Accepted
- **Date:** 2026-06-07
- **Phase:** 3
- **Builds on:** spec 0001 (domain/persistence), spec 0002 (categorisation),
  ADR-0004 (determinism-first), ADR-0005 (money), ADR-0007 (MCP server design).

## Summary / Goal

Expose the persisted financial domain as **deterministic, read-only MCP tools** so
the Phase 4 agent can answer natural-language questions by calling them. No LLM in
this phase: the tools do all data access + money aggregation. Packaged as
`@ledger-lens/mcp-server` over the extracted `@ledger-lens/db`.

## Determinism-vs-LLM decision (central)

| Unit of work | `ComputeKind` | Rationale |
|---|---|---|
| Tool data access (list/filter/get) | `deterministic` | SQL + the existing repository. |
| Money aggregation (by-category, net flow) | `deterministic` | Pure folds over the shared same-currency `Money`. |
| Zod-validating tool inputs/outputs | `deterministic` | Schema validation at the tool boundary. |
| Orchestrating the tools from NL | *(Phase 4)* | The agent — **not** built here. |

**No LLM ships in Phase 3.**

## Tool surface (read-only)

Each tool has a Zod input schema and a typed output (`structuredContent` + a short
text rendering). Money is always a `MoneyDTO` (string minor units + currency).

| Tool | Input | Output |
|---|---|---|
| `list_accounts` | `{}` | `{ accounts: Account[] }` |
| `get_account` | `{ accountId: uuid }` | `Account` — unknown id → tool error |
| `list_transactions` | `{ accountId: uuid, dateFrom?: date, dateTo?: date, category?: Category, direction?: "debit"\|"credit", limit?: 1..200=50, cursor?: string }` | `{ items: TransactionListItem[], nextCursor: string\|null }` (`amount` = MoneyDTO, includes `category`) |
| `summarize_spending_by_category` | `{ accountId: uuid, dateFrom?: date, dateTo?: date }` | `{ accountId, currency, from?, to?, categories: [{ category, total: MoneyDTO, transactionCount }], total: MoneyDTO }` — **debits only**, sorted by total desc |
| `summarize_account` | `{ accountId: uuid, dateFrom?: date, dateTo?: date }` | `{ accountId, currency, from?, to?, totalIn: MoneyDTO, totalOut: MoneyDTO, net: { direction, amount: MoneyDTO }, transactionCount }` |

`Account` = `{ id, name, institution, currency, kind }`. `raw_row` is never exposed.

## Money / aggregation semantics

- Sums fold with the shared `Money` seeded from `account.currency`
  (`zeroMoney`/`addMoney`); `net` is computed via `compareMoney` + `subtractMoney`
  so it is a non-negative `{ direction, amount }` pair.
- **Single-currency-account invariant by construction:** ingestion's currency
  guard (spec 0001) means every transaction shares the account currency, so a fold
  never mixes currency.
- `summarize_spending_by_category` sums **debits only** (spending = outflows;
  folding in credits would conflate refunds/income). A debit with `category = NULL`
  (not yet categorised) buckets under `uncategorized`.
- No `bigint`/float ever leaves a tool — only `MoneyDTO`.

## Repository reuse (no duplication, no LLM)

- Reuse `getAccountById`.
- **Extend `listTransactions`** (in `@ledger-lens/db`) with optional
  `dateFrom`/`dateTo`/`category`/`direction` filters — backward-compatible (the
  HTTP endpoint passes none; reuses the keyset pagination + list projection).
- **New read queries** in `@ledger-lens/db`: `listAccounts`; and
  `listTransactionAmounts({ accountId, dateFrom?, dateTo? })` returning minimal
  `{ category, direction, amountMinor }` rows for the aggregation folds.
- The **aggregation fold** is a pure function over rows (reuses shared `Money`),
  unit-tested without a DB. SQL `SUM ... GROUP BY` is the later scale path
  (ADR-0007).

## Architecture / transport

- `packages/mcp-server` (`@ledger-lens/mcp-server`) depends on `@ledger-lens/db` +
  `@ledger-lens/shared` only.
- Tool handlers are plain `(db, input) -> output` functions; a thin `server.ts`
  registers them on an `McpServer` and a `main.ts` connects a
  `StdioServerTransport` (reads `DATABASE_URL`, reuses `createDatabase`).
- Transport-agnostic handlers → streamable-HTTP can be added for Phase 7.

## Testing strategy

- **Integration (`packages/mcp-server/*.itest.ts`, testcontainers + seeded data):**
  migrate + seed + persist drafts (+ set a few categories via `applyCategorizations`),
  then **call each handler directly in-process**: list/filter transactions,
  by-category totals (exact `Money`), net flow, unknown account → error, invalid
  input rejected by the Zod schema. No transport / agent / LLM / network.
- **Unit (`*.test.ts`, no DB, runs under `pnpm check`):** the pure aggregation
  folds over hand-built rows (exact Money arithmetic incl. zero/empty/edge cases);
  the tool input schemas rejecting bad input (`schemas.test.ts`); and the handlers
  over a **mocked `@ledger-lens/db`** (`tools.test.ts`) — DTO mapping, `raw_row`
  exclusion, the not-found throw, default/echo params, and account-currency seeding
  — so the handler behaviour is verified Docker-free, not only by the integration
  suite.

## Out of scope (later phases)

- The Phase 4 agent that orchestrates these tools (Agent SDK).
- Mutating tools; a `get_transaction`/`raw_row` audit tool.
- Streamable-HTTP transport (Phase 7), SQL aggregation, net-per-category.
