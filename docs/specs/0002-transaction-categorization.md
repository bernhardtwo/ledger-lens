# 0002. Transaction categorization (first LLM feature)

- **Status:** Accepted
- **Date:** 2026-06-07
- **Phase:** 2
- **Builds on:** spec 0001 (domain + ingestion + persistence + HTTP), ADR-0004
  (determinism-first), ADR-0006 (categorization design).

## Summary / Goal

Enrich already-persisted transactions with a **category** drawn from a closed
taxonomy, assigned by the Claude API. User-visible outcome: after
`POST /accounts/:id/categorize`, `GET /accounts/:id/transactions` shows a
`category` on each transaction. Categorization is enrichment over the deterministic
core — it never blocks or alters ingestion, money, or persistence.

## Determinism-vs-LLM decision (central)

This is the **only `llm-assisted` unit in the system**. Everything around it stays
deterministic.

| Unit of work | `ComputeKind` | Rationale |
|---|---|---|
| Assign a category label from `description` (+ direction/amount as context) | **`llm-assisted`** | Open-vocabulary mapping of free-text merchant strings to intent — the one place an LLM earns its place. |
| The taxonomy itself (closed enum) | `deterministic` | A fixed Zod enum in `shared`; the model can only pick from it. |
| Validating + reconciling the model's output | `deterministic` | Zod gate + index→id reconciliation + per-item fallback. |
| Batching, idempotent NULL-only selection, persistence | `deterministic` | Pure functions + SQL. |
| Money / amounts | `deterministic` | Untouched by the LLM (ADR-0005). |

The LLM picks a label; **deterministic code decides what to trust and what to
store.**

## Taxonomy (`@ledger-lens/shared`)

`CategorySchema = z.enum([...])` — single source of truth for the LLM tool schema
**and** persistence. 14 categories + an explicit fallback:

```
groceries · dining · transport · shopping · utilities · housing · health ·
entertainment · travel · income · transfers · fees · subscriptions · education ·
uncategorized
```

Deliberately lean — a smaller closed set classifies more reliably and is easier to
eval. (`cash`/ATM is omitted: the synthetic statements contain no ATM activity.)

## Flow

```
[1 select uncategorized]  category IS NULL, account-scoped, ordered (txn_date,id)
   → [2 batch ×50] → [3 forced tool-use call (Haiku)] → [4 Zod-validate]
   → [5 reconcile index→id, per-item fallback] → [6 persist category columns]
```

1. **Select.** `listUncategorizedTransactions(account)` returns `category IS NULL`
   rows (`id`, `description`, `direction`, `amount_minor`, `currency_code`).
2. **Batch.** Sequential batches of 50 (`ANTHROPIC_CATEGORIZATION_BATCH_SIZE`).
   Each item gets a batch-local index `1..N`; the index→id map is kept locally.
3. **Call.** One forced tool call per batch — `record_categorizations`,
   `tool_choice: {type:"tool"}`, `claude-haiku-4-5`, `temperature: 0`, small
   `max_tokens`. The user message lists items as `N. [direction] amount CUR — desc`.
   The client returns the **raw, unvalidated** tool input (`unknown`).
4. **Validate.** Zod-parse the envelope `{ categorizations: [{ index, category }] }`;
   each `category` is checked against `CategorySchema`.
5. **Reconcile + fallback.** For each input index, take its validated category, else
   `uncategorized`. Order is never trusted; unparseable envelope → whole batch →
   `uncategorized`.
6. **Persist.** `UPDATE transactions SET category, category_model, categorized_at
   WHERE id = ? AND category IS NULL` (the `IS NULL` guard keeps it idempotent under
   concurrency).

**Failure semantics.** A *transport* error on a batch propagates out of the pure
core; the service counts those items as `failed` and **leaves them `NULL`**
(resumable next run). A *successful-but-invalid* output writes `uncategorized`
(terminal). Categorization never throws into the HTTP request beyond the mapped
status codes; ingestion/persistence are never touched.

## Persistence

Three nullable columns added to `transactions` (migration via drizzle-kit):

```ts
category        text   $type<Category>   // null = not yet categorized
category_model  text                     // model id used, for audit/eval
categorized_at  timestamptz              // when categorized
```

No new table this phase (history table is a future path — ADR-0006). The default
list projection gains `category`.

## API surface

- **`POST /accounts/:accountId/categorize`** — validates `accountId` (uuid), 404s
  an unknown account, categorizes that account's `category IS NULL` transactions in
  batches, returns:
  ```ts
  CategorizeResponseSchema = z.object({
    totalUncategorized: z.number().int(),  // rows that were NULL at start
    categorized: z.number().int(),         // assigned a real category
    uncategorized: z.number().int(),       // assigned the fallback
    failed: z.number().int(),              // transport-failed this run; still NULL
  });
  ```
  Re-running once everything is categorized is a no-op (`totalUncategorized: 0`).
- **`GET /accounts/:accountId/transactions`** — list item now includes
  `category: Category | null`.

## Client seam (mockable)

```ts
interface CategorizationClient {
  readonly modelId: string;
  categorize(items: CategorizationItem[]): Promise<unknown>; // raw tool input
}
```

- Pure core (`src/categorization/core.ts`) imports **no SDK**; it owns batching,
  validation, reconciliation, fallback.
- Real adapter (`AnthropicCategorizationClient`) wraps `@anthropic-ai/sdk`,
  constructs the SDK **lazily** (so DI/app boot needs no API key), reads
  `ANTHROPIC_API_KEY` (server-side only) + `ANTHROPIC_CATEGORIZATION_MODEL`.
- Injected via a Nest token; overridden with a mock in tests.

## Testing strategy

- **Unit (mocked client, `src/categorization/*.test.ts`):** batching (N→K calls),
  Zod validation, off-taxonomy → `uncategorized`, missing/extra index →
  `uncategorized`, unparseable envelope → all `uncategorized`, transport error →
  `failed` (left for retry), shuffled order still reconciles by index.
- **Integration (`*.itest.ts`, mocked client + testcontainers):** ingest a CSV →
  `POST /categorize` writes categories → `GET` shows them; **re-categorize is a
  no-op**; an `uncategorized` fallback path.
- **NO real API call in any suite or in CI.** A separate, clearly-marked manual
  `smoke:categorize` script is the only path that hits the real API.

## Out of scope (later phases)

- The Agent SDK / MCP domain server (Phases 3–4).
- The eval harness + golden categorized dataset (Phase 5).
- A `categorizations` history table, confidence scores, force-recategorize.
- Auto-categorize on ingest, multi-currency-per-file, FX.
