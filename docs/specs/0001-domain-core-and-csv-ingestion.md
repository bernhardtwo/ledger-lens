# 0001. Domain core + CSV ingestion

- **Status:** Accepted
- **Date:** 2026-06-02
- **Phase:** 1
- **Supersedes/Builds on:** ADR-0002 (monorepo), ADR-0004 (determinism-first)

## Summary / Goal

Stand up the first real domain layer of LedgerLens: the canonical normalized
domain model (`Money`, `Account`, `Statement`, `Transaction`) in
`@ledger-lens/shared`, a deterministic CSV ingestion pipeline that turns a
heterogeneous bank/credit CSV into validated, persisted `Transaction`s, the
Drizzle/Postgres schema to store them, and two NestJS endpoints (ingest a CSV,
list transactions). User-visible outcome: a user can upload a CSV statement and
immediately list back the normalized, deduplicated transactions with exact
amounts. Everything downstream (categorisation, reconciliation, PDF, the agent)
relies on the `Transaction` shape defined here.

## Determinism-vs-LLM decision (central)

CSV is structured input. **The entire Phase 1 pipeline is deterministic.** No LLM
call ships in this phase. Each unit is a `FeatureBoundary` (`@ledger-lens/shared`)
and is registered in code so the boundary is auditable.

| Unit of work | `ComputeKind` | Rationale (one line) |
|---|---|---|
| Money parsing & arithmetic (minor units) | `deterministic` | Pure integer math; floats are unacceptable for currency. |
| CSV tokenizing / dialect (delimiter, quoting) | `deterministic` | Sniffable from the bytes; a parser library handles it reliably. |
| Column mapping (CSV header → canonical field) | `deterministic` | Driven by a versioned mapping-profile config keyed by detected header signature. |
| Date parsing / normalization to ISO | `deterministic` | Format is declared per profile; parse with a fixed format + timezone rule. |
| Amount/sign → debit/credit direction | `deterministic` | Pure rules per profile (signed-amount vs. debit/credit columns). |
| Row validation (Zod) | `deterministic` | Schema validation at the trust boundary. |
| Dedupe / idempotency | `deterministic` | Content hash + DB unique constraint. |
| **Profile inference for an *unknown* bank format** | *(deferred)* | Would be the *only* `llm-assisted` candidate; **out of scope** this phase — see Open Questions. |

This explicit "no LLM here" is the intended signal: structured ingestion is a
pure-function problem and is treated as such.

## Domain model

Lands in `packages/shared/src/domain/` and is re-exported from
`packages/shared/src/index.ts`. Types are inferred from Zod schemas (single
source of truth) via `z.infer`.

**Money representation — see ADR-0005 (authoritative).** Amounts are integer
**minor units** (cents) held in `bigint`, never a float. The magnitude is
**non-negative**; sign lives in `Transaction.direction`. `currency` is a flat
ISO-4217 `CurrencyCode`; `minorUnitExponent` (USD/MXN/COP=2, JPY=0, BHD=3) comes
from a small ISO-4217 registry in `shared`, so display/scaling is data-driven.
Arithmetic is same-currency only and **throws** on mismatch — no implicit FX.

```ts
// money.ts  (see ADR-0005)
// Internal value object: non-negative magnitude; direction lives on Transaction.
export interface Money {
  readonly amount: bigint;            // minor units, >= 0n
  readonly currency: CurrencyCode;    // ISO-4217: "USD" | "MXN" | "COP" | ...
  readonly minorUnitExponent: number; // from the shared ISO-4217 registry
}

// Boundary schema (JSON-safe): amount is a decimal-free string of minor units.
export const MoneySchema = z.object({
  amount: z.string().regex(/^\d+$/),  // minor units as string; >= 0
  currency: CurrencyCodeSchema,       // ISO-4217, registry-backed
  minorUnitExponent: z.number().int().min(0).max(4),
});

// pure helpers (no class needed): add/sub/neg/abs/compare/isZero,
// fromDecimalString(s, currency) -> Money, toDecimalString(Money) -> string.
// add/sub require matching currency and THROW on mismatch — no implicit FX.
```

```ts
// transaction.ts
export const DirectionSchema = z.enum(["debit", "credit"]); // debit = money out
export const TransactionSchema = z.object({
  id: z.string().uuid(),                       // assigned at persist
  accountId: z.string().uuid(),
  statementId: z.string().uuid(),
  transactionDate: IsoDateSchema,              // canonical: when the txn occurred
  postedDate: IsoDateSchema.nullable(),        // bank posting/value date; null when absent
  description: z.string().min(1),              // canonicalized via normalizeDescription
  direction: DirectionSchema,
  amount: MoneySchema,                         // non-negative magnitude; sign lives in direction
  fingerprint: z.string().min(1),              // dedupe key (see ingestion)
  rawRow: z.record(z.string(), z.string()),    // original CSV row, for audit/replay
});
export type TransactionDTO = z.infer<typeof TransactionSchema>;
```

**Dual dates (resolves Open Question 3).** We store **both** dates:
`transactionDate` is the canonical date (drives ordering, dedupe and
reconciliation) and is required; `postedDate` is the bank's posting/value date,
kept when the source provides one and `null` otherwise. Both are calendar dates
(`IsoDateSchema`, `YYYY-MM-DD`), never instants — see `iso-date.ts`.

**`rawRow` is audit-only.** The original CSV row is retained for replay/audit but
is **excluded from the default/list projection** the API returns:
`TransactionListItemSchema = TransactionSchema.omit({ rawRow: true })`. Listings
stay lean and never leak the raw source shape; `rawRow` is exposed only on an
explicit single-transaction/audit fetch. `description` is the output of the
canonical `normalizeDescription` (see Testing/ingestion), the *same* normalizer
that feeds the fingerprint, so the stored text and the dedupe key never diverge.

`Account` (`id`, `name`, `institution`, `currency`, `kind: "bank" | "credit"`) and
`Statement` (`id`, `accountId`, `sourceFilename`, `profileId`, `ingestedAt`,
`rowCount`) get matching Zod schemas in the same folder.

**Canonical normalized shape decision:** `amount` is always non-negative and
direction is explicit. We do **not** carry signed amounts downstream — every
consumer reads `direction` + non-negative `Money`. This removes per-bank sign
ambiguity from all downstream code.

## CSV ingestion design

Pipeline lives in `apps/api/src/ingestion/` as injectable NestJS services, each a
thin wrapper over pure functions (the pure functions are the testable core).

```
bytes → [1 sniff dialect] → [2 select profile] → [3 map+normalize rows]
      → [4 Zod-validate] → [5 fingerprint+dedupe] → [6 persist]
```

1. **Dialect sniff** (`csv-parse` with auto delimiter/quote detection). Reject
   non-UTF-8 / empty files early.
2. **Profile selection.** A *mapping profile* is versioned config (TS objects in
   `apps/api/src/ingestion/profiles/`), keyed by a normalized header signature
   (sorted, lowercased column names). The profile declares: column→field map,
   date format + timezone, amount strategy (`signed-amount` | `debit-credit-cols`),
   and `currency`. Selection is exact-match on header signature in this phase. No
   match → `422` with the unrecognized signature (so adding a profile is a config
   PR, reviewable). This keeps mapping fully deterministic and auditable.
3. **Map + normalize** (pure `normalizeRow(profile, rawRow) -> NormalizedRow`):
   parse date to ISO (declared format, no locale guessing), parse amount via
   `Money.fromDecimalString` against `profile.currency`, derive `direction` and a
   non-negative `amount`.
4. **Zod validation** at the boundary: each row → `TransactionSchema`
   (`omit` server-assigned `id`/`statementId`). Malformed rows are collected, not
   fatal: the response reports `accepted` and `rejected[]` (row index + reason).
   Threshold: if `rejected/total > 0.5`, fail the whole ingest (`422`) — likely a
   wrong profile.
5. **Fingerprint + idempotency.** `fingerprint = sha256(accountId |
   transactionDate | amountMinor | direction | normalizeDescription(description) |
   occurrenceOrdinal)`. Two decisions are encoded here:
   - **Re-importing the same statement does NOT duplicate.** The fingerprint
     excludes `statementId` (a re-import gets a fresh statement id), and the same
     bytes reproduce the same rows in the same order — so a re-upload yields
     identical fingerprints and the unique `(account_id, fingerprint)` index skips
     them. Duplicates are reported as `skipped`, not errors.
   - **Legitimately-identical rows are NOT collapsed.** Two genuine same-content
     rows in one file (e.g. two $5 coffees on the same day) must both survive, so
     the fingerprint includes a **per-row occurrence ordinal** — the k-th row
     sharing that exact content tuple — giving distinct same-content rows distinct
     keys. The description component is the canonical `normalizeDescription` (the
     single normalizer also applied to the stored `description`, so the two can
     never disagree); it is idempotent, keeping the key stable across re-imports.
6. **Persist** transactions + a `Statement` row in one transaction (see below).

Error handling is structured: a typed `IngestionError` discriminated union
(`unknown-profile` | `not-utf8` | `too-many-rejected`) maps to HTTP codes in a
NestJS exception filter. No throwing of raw library errors past the boundary.

## Persistence

Postgres + Drizzle. Schema in `apps/api/src/db/schema.ts`; migrations via
`drizzle-kit` into `apps/api/drizzle/`. Money stored as the integer minor unit
(`bigint`) + an ISO-4217 `currency_code` (per ADR-0005). The `minorUnitExponent`
is **derived from the shared ISO-4217 registry, not stored** — **never `numeric`
used as a float, never a double**.

```ts
accounts(id uuid pk, name text, institution text, currency_code char(3),
         kind text)                                        // "bank"|"credit"
statements(id uuid pk, account_id uuid fk, source_filename text,
           profile_id text, row_count int, ingested_at timestamptz)
transactions(
  id uuid pk default, account_id uuid fk, statement_id uuid fk,
  transaction_date date not null,                          // canonical date
  posted_date date,                                        // bank posting date; nullable
  description text, direction text,                        // "debit"|"credit"
  amount_minor bigint, currency_code char(3),              // exponent from registry
  fingerprint text, raw_row jsonb,                         // raw_row excluded from list projection
  unique(account_id, fingerprint)                          // idempotency
)
```

`bigint` columns map to JS `bigint` via Drizzle's `mode: "bigint"`. Account is
assumed to pre-exist (created out of band / seeded) this phase; statement is
created per ingest. Insert uses `onConflictDoNothing` on the unique index for
idempotency, and the count of skipped rows comes from the diff.

## API surface

NestJS controller `apps/api/src/ingestion/ingestion.controller.ts`. Zod at both
edges (via a small `ZodValidationPipe`); HTTP DTOs are Zod-inferred.

- **`POST /accounts/:accountId/statements`** — multipart upload, field `file`
  (CSV). Validates `accountId` (uuid) and content type. Returns:
  ```ts
  IngestResponseSchema = z.object({
    statementId: z.string().uuid(),
    profileId: z.string(),
    accepted: z.number().int(),
    skipped: z.number().int(),                  // duplicates
    rejected: z.array(z.object({ row: z.number().int(), reason: z.string() })),
  });
  ```
- **`GET /accounts/:accountId/transactions?limit&cursor`** — Zod-validated query;
  returns `{ items: Transaction[], nextCursor?: string }`. Keyset pagination on
  `(posted_at, id)`. `Money.amount` is serialized as a string of minor units in
  JSON (bigint is not JSON-native) and re-coerced by `MoneySchema` on the way out.

Both responses are parsed through their Zod schema before send (output trust
boundary). All shared schemas imported from `@ledger-lens/shared`.

## Testing strategy

- **Golden fixtures for the parser** (`apps/api/src/ingestion/__fixtures__/`):
  small synthetic CSVs per supported profile (e.g. `bank-a.csv`,
  `credit-b-debit-credit-cols.csv`) plus an expected `NormalizedRow[]` golden
  JSON. Test asserts parse output equals golden, byte-for-byte on amounts/dates.
  Include adversarial fixtures: European decimal comma, negative-as-`(123.45)`,
  trailing blank rows, an unknown-header file (expects `unknown-profile`), and a
  mostly-garbage file (expects `too-many-rejected`).
- **Money math unit tests** (`packages/shared`): add/sub/neg/compare,
  `fromDecimalString`/`toDecimalString` round-trips across exponents (JPY=0,
  USD/MXN/COP=2, BHD=3), currency-mismatch throws, large values beyond `2^53`.
  Property-style check:
  `toDecimalString(fromDecimalString(s)) === s` for a generated set.
- **Idempotency test:** ingest the same fixture twice → second call returns all
  rows as `skipped`, row count unchanged.
- **Supertest** (`apps/api`): `POST` a fixture upload → asserts response schema +
  DB rows; `GET` paginates correctly; bad uuid / wrong content-type → 4xx with the
  typed error body. Runs against a disposable Postgres (docker-compose service).
- All pure functions are covered without a DB; only persistence + controller
  tests need Postgres. No LLM, so **no `packages/evals` work this phase.**

## Out of scope (later phases)

- PDF extraction (Phase 2, `llm-assisted`).
- Transaction categorisation, reconciliation arithmetic (later; reconciliation
  math will be `deterministic`).
- The agent loop, MCP domain server (Phases 3-4).
- LLM-based profile inference for unknown CSV layouts (see Open Questions).
- Auth/multi-tenant, account creation UI, currency FX conversion.

## Open questions

1. **Unknown-format fallback.** Exact header-signature matching means a new bank
   needs a config PR. Acceptable for a portfolio demo, but is an `llm-assisted`
   "infer the mapping profile, human-confirm, then persist as deterministic
   config" flow worth a later phase? (Leaning yes — it's a clean determinism/LLM
   showcase.)
2. **Multi-currency statements.** Profiles assume one currency per file. Do any
   target synthetic statements mix currencies per row? If so, currency must move
   from profile to per-row parsing.
3. **Date semantics. — RESOLVED.** Store **both**: `transactionDate` is canonical
   (required; drives ordering, dedupe and reconciliation) and `postedDate` is the
   bank's posting/value date (optional, `null` when the source omits it). This
   avoids a later migration if reconciliation needs the posting date, at the cost
   of one nullable calendar-date column. See the domain model section above.
4. **`raw` storage cost.** Keeping the full original row as `jsonb` aids
   audit/replay but bloats the table. Keep for now; revisit if it matters.
