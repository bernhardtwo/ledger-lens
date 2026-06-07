# 0005. Money and currency representation

- **Status:** Accepted
- **Date:** 2026-06-02

## Context

LedgerLens is a financial analyst: the numbers it shows must be exact. JavaScript
`number` is IEEE-754 floating point and cannot represent most decimal money values
exactly (`0.1 + 0.2 !== 0.3`), so it is unacceptable for storage or arithmetic.

The domain is also inherently multi-currency (the author's own context spans MXN,
COP and USD), and source statements disagree on how they encode value: some use a
single signed amount, some use separate debit/credit columns, some use negative
for outflows and some for inflows. Downstream consumers (metrics, reconciliation,
the agent) must not have to re-derive sign or currency semantics.

This ADR fixes how money is represented across `@ledger-lens/shared`, the DB, and
every trust boundary. It is an application of the determinism-first rule
(ADR-0004): money is always computed by deterministic code, never by an LLM.

## Decision

**1. Integer minor units, no floats.** Amounts are stored and computed as integer
**minor units** (e.g. cents) using `bigint`. No `number` ever holds a money value.

**2. Money is a currency-aware value object.** Defined in `@ledger-lens/shared`:

```ts
// Non-negative magnitude. Direction (debit/credit) lives on Transaction,
// so there is zero sign ambiguity for downstream consumers.
export interface Money {
  readonly amount: bigint;          // minor units, >= 0n
  readonly currency: CurrencyCode;  // ISO-4217, e.g. "USD" | "MXN" | "COP"
  readonly minorUnitExponent: number; // ISO-4217 exponent: USD/MXN/COP=2, JPY=0, BHD=3
}
```

A small ISO-4217 registry in `shared` provides the `minorUnitExponent` per
currency (so JPY=0 and BHD=3 are handled, not just the 2-decimal common case).

**3. Sign ambiguity is removed at the model boundary.** A transaction carries a
**non-negative `Money` magnitude** plus an explicit `direction: "debit" | "credit"`.
Mapping profiles are responsible for translating each bank's encoding into this
canonical form during ingestion.

**4. Arithmetic is same-currency only.** Money operations (`add`, `subtract`,
`compare`) require matching `currency`; **mixed-currency operations throw**. There
is no implicit conversion anywhere.

**5. FX is explicitly out of scope.** No exchange rates, no conversion, no
cross-currency aggregation in this phase. Aggregations operate **per currency**.
Foreign-exchange is a separate, *dated and sourced* concern to be introduced in a
future ADR; it does not change this representation.

**6. Serialization at boundaries.** `bigint` is not valid JSON and `number` would
lose precision, so at every Zod edge (API in/out, LLM structured output) the
amount is a **decimal-free numeric string of minor units** (e.g. `"123456"`).
Parsing a human decimal string (`"1234.56"`) into minor units is done by exponent
shift with string handling — never via `parseFloat`.

```ts
export const MoneySchema = z.object({
  amount: z.string().regex(/^\d+$/), // minor units as string; >= 0
  currency: CurrencyCodeSchema,
  minorUnitExponent: z.number().int().min(0).max(4),
});
```

> **Note (as shipped):** the implemented `MoneySchema` validates
> `minorUnitExponent` against the ISO-4217 registry via `superRefine` (it must
> equal `minorUnitExponentOf(currency)`), which is stronger than the illustrative
> `.min(0).max(4)` bound sketched above — a DTO can never disagree with its own
> currency.

**7. Storage.** In Postgres the amount column is `bigint` (minor units) alongside
a `currency` text column constrained to ISO-4217. Display formatting (inserting
the decimal point, locale, symbol) happens only at the presentation edge.

## Alternatives considered

- **Floating point (`number`)** — simplest, but inexact for decimals. Rejected
  outright for money.
- **A decimal library (decimal.js / big.js) as the stored type** — exact, but adds
  a runtime dependency to the core model and still needs a currency/direction
  wrapper. Integer minor units are exact, dependency-free for storage, and map
  cleanly to a `bigint` column. A decimal lib may still be used *locally* inside a
  parser if a specific format demands it, but it is not the stored representation.
- **Postgres `NUMERIC(p,s)` as the source of truth** — also exact, and a common
  choice. Rejected as the primary because it pushes money logic into SQL and
  returns strings across the JS boundary anyway; keeping a single `bigint`
  representation puts all money math in typed, unit-tested TypeScript where the
  `Money` value object enforces currency and direction rules.
- **A single signed amount, no explicit direction** — fewer fields, but inherits
  each bank's sign convention and forces every consumer to re-interpret it.
  Rejected in favour of magnitude + explicit `direction`.
- **Implicit cross-currency arithmetic with a default rate** — convenient but
  silently wrong (stale/unsourced rates produce confident bad numbers). Rejected;
  mixed-currency throws instead.

## Consequences

- **Positive:** exact arithmetic with no float bugs; currency and direction are
  explicit and unambiguous; `bigint` maps directly to a DB column; money math is
  centralised in a testable value object; the model is multi-currency-ready from
  day 1.
- **Negative (accepted):** `bigint` must be serialized as a string at JSON
  boundaries; display requires an exponent-aware formatting step; mixed-currency
  operations throwing means aggregation code must group by currency first — this
  friction is intentional and prevents a class of silent errors.
- **Follow-ups:**
  - Implement the `Money` value object, the ISO-4217 registry, `MoneySchema`, and
    parsing/formatting helpers in `@ledger-lens/shared`, with unit tests covering
    zero-exponent (JPY), 3-exponent (BHD), rounding-free parsing, and the
    mixed-currency throw.
  - Per-currency aggregation lands with the metrics phase.
  - A future ADR will introduce FX (dated, sourced rates) without altering this
    representation.
