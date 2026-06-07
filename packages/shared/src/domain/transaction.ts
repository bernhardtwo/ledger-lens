/**
 * Transaction domain type — the canonical normalized shape (see spec 0001,
 * ADR-0005). Everything downstream (categorisation, reconciliation, the agent)
 * reads this shape, so the sign/currency ambiguity of raw bank data is resolved
 * here, once.
 *
 * Key decisions encoded below:
 *
 * - **Magnitude + direction, never a signed amount.** `amount` is a non-negative
 *   `Money` (ADR-0005); whether it moved money out or in lives in `direction`
 *   (`"debit"` = out). No consumer re-derives sign from a per-bank convention.
 *
 * - **`transactionDate` is canonical; `postedDate` is optional.** The date the
 *   transaction occurred drives ordering and reconciliation; the bank's
 *   posting/value date is kept when present and is `null` otherwise. Both are
 *   calendar dates (`IsoDate`), not instants — see `iso-date.ts`.
 *
 * - **Domain vs. boundary.** In memory `amount` is a `Money` value object
 *   (`bigint` minor units). At the boundary `TransactionSchema` (the DTO) carries
 *   `amount` as a `MoneyDTO` (string minor units) and dates as ISO strings, since
 *   `bigint` is not JSON. `toTransactionDTO` / `parseTransaction` cross the line.
 *
 * - **`rawRow` is audit-only and not a default projection.** The original CSV row
 *   is retained for replay/audit but excluded from the list projection
 *   (`TransactionListItem*`) the API returns by default, so listings stay lean
 *   and don't leak the raw source shape.
 */
import { z } from "zod";
import { type IsoDate, IsoDateSchema } from "./iso-date.js";
import { type Money, MoneySchema, money, toMoneyDTO } from "./money.js";

/** Direction of value flow. `"debit"` = money out of the account; `"credit"` = in. */
export const DirectionSchema = z.enum(["debit", "credit"]);
export type Direction = z.infer<typeof DirectionSchema>;

/**
 * JSON-safe boundary (DTO) schema for a persisted `Transaction`.
 *
 * `amount` is a `MoneyDTO` (string minor units) and dates are ISO `YYYY-MM-DD`
 * strings — see `MoneySchema` / `IsoDateSchema`. The in-memory `Transaction`
 * (below) swaps `amount` for a `Money` value object.
 */
export const TransactionSchema = z.object({
  id: z.string().uuid(), // assigned at persist
  accountId: z.string().uuid(),
  statementId: z.string().uuid(),
  transactionDate: IsoDateSchema, // canonical: when the transaction occurred
  postedDate: IsoDateSchema.nullable(), // bank posting/value date; null when absent
  description: z.string().min(1),
  direction: DirectionSchema,
  amount: MoneySchema, // non-negative magnitude; sign lives in `direction`
  fingerprint: z.string().min(1), // idempotency key — see FINGERPRINT note below
  rawRow: z.record(z.string(), z.string()), // original CSV row, for audit/replay
});

/** The serialized form of a `Transaction` (see `TransactionSchema`). */
export type TransactionDTO = z.infer<typeof TransactionSchema>;

/**
 * Default / list projection at the boundary: a `Transaction` **without** the
 * heavyweight `rawRow`. This is what `GET .../transactions` returns; `rawRow` is
 * only exposed on an explicit single-transaction/audit fetch.
 */
export const TransactionListItemSchema = TransactionSchema.omit({ rawRow: true });
export type TransactionListItemDTO = z.infer<typeof TransactionListItemSchema>;

/** Draft of a row before persistence: server-assigned `id`/`statementId` removed. */
export const TransactionDraftSchema = TransactionSchema.omit({ id: true, statementId: true });
export type TransactionDraftDTO = z.infer<typeof TransactionDraftSchema>;

/**
 * A persisted transaction as held in memory. Differs from `TransactionDTO` only
 * in `amount`: a `Money` value object here, a `MoneyDTO` at the boundary.
 */
export interface Transaction {
  readonly id: string;
  readonly accountId: string;
  readonly statementId: string;
  /** Canonical calendar date the transaction occurred. */
  readonly transactionDate: IsoDate;
  /** Bank posting/value date when the source provides one; otherwise `null`. */
  readonly postedDate: IsoDate | null;
  readonly description: string;
  readonly direction: Direction;
  /** Non-negative magnitude; the sign is carried by `direction`. */
  readonly amount: Money;
  /**
   * FINGERPRINT — idempotency key, computed deterministically by the ingestion
   * pipeline (`apps/api`; sha256 there, kept out of this dependency-light core).
   * Re-importing the *same* statement must not duplicate rows, yet two
   * legitimately-identical transactions in one statement (e.g. two $5 coffees on
   * the same day) must both survive.
   *
   * The fingerprint therefore hashes the normalized content — `accountId`,
   * `transactionDate`, minor-unit amount, `direction`, normalized `description`
   * — **plus an occurrence ordinal**: the k-th row in the file sharing that exact
   * content tuple. It deliberately excludes `statementId` (a re-import gets a new
   * statement id, so including it would defeat idempotency). Because the same
   * bytes reproduce the same rows in the same order, a re-import yields identical
   * fingerprints (the unique `(accountId, fingerprint)` index then skips them),
   * while distinct same-content rows get distinct ordinals and are both kept.
   */
  readonly fingerprint: string;
  /** Original CSV row, retained for audit/replay; omitted from list projections. */
  readonly rawRow: Readonly<Record<string, string>>;
}

/** List/default projection of a `Transaction`: everything except `rawRow`. */
export type TransactionListItem = Omit<Transaction, "rawRow">;

/**
 * A transaction ready to persist: a `Transaction` without the server-assigned
 * `id`/`statementId`. The in-memory counterpart of `TransactionDraftDTO` (`amount`
 * is a `Money` value object here). Produced by the ingestion core and consumed by
 * the persistence layer (`@ledger-lens/db`).
 */
export type TransactionDraft = Omit<Transaction, "id" | "statementId">;

/** Serialize a `Transaction` to its full JSON-safe DTO (includes `rawRow`). */
export function toTransactionDTO(transaction: Transaction): TransactionDTO {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    statementId: transaction.statementId,
    transactionDate: transaction.transactionDate,
    postedDate: transaction.postedDate,
    description: transaction.description,
    direction: transaction.direction,
    amount: toMoneyDTO(transaction.amount),
    fingerprint: transaction.fingerprint,
    rawRow: { ...transaction.rawRow },
  };
}

/** Serialize a `Transaction` to the list projection DTO (drops `rawRow`). */
export function toTransactionListItemDTO(transaction: Transaction): TransactionListItemDTO {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    statementId: transaction.statementId,
    transactionDate: transaction.transactionDate,
    postedDate: transaction.postedDate,
    description: transaction.description,
    direction: transaction.direction,
    amount: toMoneyDTO(transaction.amount),
    fingerprint: transaction.fingerprint,
  };
}

/** Validate and deserialize an unknown input into a `Transaction` at a boundary. */
export function parseTransaction(input: unknown): Transaction {
  const dto = TransactionSchema.parse(input);
  // `dto.amount` is already a validated `MoneyDTO` (TransactionSchema embeds
  // MoneySchema, regex + registry cross-check included). Construct the value
  // object directly instead of re-running `parseMoney` — one validation pass,
  // not two. `money()` re-derives the exponent from the registry, the source of
  // truth, so the wire-provided exponent is never trusted here either.
  return {
    id: dto.id,
    accountId: dto.accountId,
    statementId: dto.statementId,
    transactionDate: dto.transactionDate,
    postedDate: dto.postedDate,
    description: dto.description,
    direction: dto.direction,
    amount: money(BigInt(dto.amount.amount), dto.amount.currency),
    fingerprint: dto.fingerprint,
    rawRow: dto.rawRow,
  };
}
