# 0006. LLM transaction categorization design

- **Status:** Accepted
- **Date:** 2026-06-07

## Context

Phase 2 introduces the **first LLM feature**: assigning a category to each
transaction. This is the place the determinism-first rule (ADR-0004) is tested in
anger — so the boundary must be drawn deliberately.

Constraints:

- **Money is never the LLM's job.** Amounts, direction, and persistence are
  already deterministic (ADR-0005, spec 0001). The model must not compute or alter
  any of them.
- **Categorization is enrichment, not part of ingestion.** A failed or nonsense
  categorization must never block or corrupt the deterministic ingest/persist path
  — transactions are already persisted before any model is called.
- **The output must be typed and validated.** A free-text label from an LLM is not
  trustworthy; the system must constrain and validate it.
- Portfolio project, synthetic data only. Tests must not hit the real API (cost,
  determinism, CI).
- Use the plain Messages API (`@anthropic-ai/sdk`) — **not** the Agent SDK or MCP
  (those are later phases).

## Decision

**1. The LLM only assigns a label from a CLOSED taxonomy.** A fixed Zod enum lives
in `@ledger-lens/shared` (`CategorySchema`, 14 categories + an explicit
`uncategorized` fallback) and is the single source of truth for both the LLM
contract and persistence validation. The model picks one slug per transaction from
`description` + `direction` + `amount` (amount is *context only* — it never does
arithmetic).

**2. Forced tool-use + Zod validation.** One forced tool call
(`record_categorizations`, `tool_choice: {type:"tool"}`) on Haiku 4.5. The tool
input is **Zod-validated**; any off-taxonomy value, missing item, or unparseable
output **degrades per-item to `uncategorized`** and never throws into the request
path. We deliberately do **not** use `strict: true` — the explicit Zod gate +
fallback is the determinism-first safety net we want to demonstrate.

**3. Batch-local integer index, reconciled locally.** Items are sent to the model
as a compact `1..N` index, not their UUIDs; the index→id mapping is kept on our
side. A small integer is echoed near-perfectly, whereas a 36-char UUID is easy to
garble (one wrong char silently drops an item) and wastes tokens. Order is never
trusted; an uncovered index → `uncategorized`.

**4. Persistence: nullable columns on `transactions`.** `category` (text,
`$type<Category>`), `category_model` (text), `categorized_at` (timestamptz) — all
nullable. **`NULL` = not yet processed; any value (incl. `uncategorized`) = done.**
- The trigger endpoint categorizes `category IS NULL` rows only, so re-running is
  idempotent (already-categorized rows are skipped).
- **Failure semantics:** a *transport* error on a batch leaves those rows `NULL`
  (resumable — retried on the next run); a *successful-but-invalid* model output
  for an item writes `uncategorized` (terminal). A future **force-recategorize**
  path will revisit `uncategorized` rows.
- A separate `categorizations` **history table** (confidence, multiple models over
  time) is the future path; one column-set is enough for v1.

**5. Mockable client seam; pure, SDK-free core.** A narrow `CategorizationClient`
interface (`categorize(items) -> Promise<unknown>` + a `modelId`) is the only
thing that touches the network. The **pure core** owns batching, prompt assembly,
Zod validation, index→id reconciliation, and fallback, and imports no SDK — so it
is fully unit-testable with a mock. The real `@anthropic-ai/sdk` adapter is
injected (Nest token), overridden with a mock in tests.

**6. Trigger.** `POST /accounts/:accountId/categorize` categorizes that account's
uncategorized transactions in **sequential batches of 50**, returns
`{ totalUncategorized, categorized, uncategorized, failed }`.

**7. Model + cost.** `claude-haiku-4-5`, parametrized via
`ANTHROPIC_CATEGORIZATION_MODEL` (the Phase 4 agent model is a separate later
decision). `temperature: 0`, small `max_tokens`. **Prompt caching is skipped for
v1**: the system prompt + taxonomy is below Haiku's ~4096-token minimum cacheable
prefix, so `cache_control` would silently no-op — but the prefix is kept stable and
deterministic so it stays cache-ready if it grows.

**8. No real API in any test suite.** Unit + integration both inject a mock
client; a separate, clearly-marked manual `smoke:categorize` script is the only
path that hits the real API and costs tokens.

## Alternatives considered

- **Structured outputs (`messages.parse` / `output_config.format`)** — equally
  valid and Haiku-supported, but forced tool-use + an explicit Zod gate makes the
  "don't trust the LLM, validate it" boundary visible, which is the point of this
  ADR. Kept as a viable swap behind the client seam.
- **`strict: true` tool use** — would guarantee enum-valid output and largely
  remove the fallback path; rejected because the validated fallback is the feature
  we want to show (and keeps us provider-portable).
- **UUIDs as the item key in the prompt** — rejected: garble-prone and token-heavy
  vs. a 1..N index.
- **Categorize synchronously during ingestion** — rejected: couples a fallible LLM
  call to the deterministic ingest/persist path it must never block. Categorization
  is a decoupled, retriable enrichment step.
- **Separate `categorizations` table now** — rejected for v1 as overkill; noted as
  the future home for history/confidence.

## Consequences

- **Positive:** the LLM is boxed into a validated label from a closed set; money
  and persistence stay 100% deterministic; categorization can fail, be retried, and
  re-run idempotently without ever blocking ingestion; cheap (~$0.0002/txn on
  Haiku); the closed taxonomy + mock seam make Phase 5 evals straightforward.
- **Negative (accepted):** categories are advisory, not guaranteed correct; an
  extra `POST /categorize` is required to enrich; `uncategorized` is terminal until
  a future force-recategorize path; one model, one prompt — no ensembling yet.
- **Follow-ups:** eval harness over a golden categorized set (Phase 5); a
  `categorizations` history table + confidence; a force-recategorize endpoint;
  prompt caching once the prefix exceeds Haiku's minimum.
