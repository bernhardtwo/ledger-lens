/**
 * Drizzle schema (see spec 0001, "Persistence"; ADR-0005).
 *
 * Column types map the canonical domain onto Postgres without losing exactness:
 *  - money is `amount_minor bigint` (minor units) + `currency_code char(3)`; the
 *    minor-unit exponent is **derived from the shared ISO-4217 registry, never
 *    stored** (and never a float / numeric);
 *  - calendar dates are `date` (Drizzle string mode -> `YYYY-MM-DD`, matching
 *    `IsoDate`); the only instant is `statements.ingested_at` (`timestamptz`);
 *  - `direction`, `kind`, `currency_code` carry their domain unions via `$type<>()`
 *    (DB columns stay `text`/`char` per the spec DDL; values are validated by Zod
 *    at the ingestion boundary);
 *  - `raw_row` is `jsonb`, retained for audit/replay and **excluded from the
 *    default/list projection** by the repository (it is never SELECTed there).
 */
import type { AccountKind, Category, CurrencyCode, Direction } from "@ledger-lens/shared";
import {
  bigint,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Accounts own statements and transactions. Seeded this phase (no CRUD yet). */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  institution: text("institution").notNull(),
  currencyCode: char("currency_code", { length: 3 }).$type<CurrencyCode>().notNull(),
  kind: text("kind").$type<AccountKind>().notNull(),
});

/** One ingestion of one CSV file into one account. */
export const statements = pgTable("statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  sourceFilename: text("source_filename").notNull(),
  profileId: text("profile_id").notNull(),
  // Count of ACCEPTED rows parsed from the file — NOT the number of transactions
  // this statement "owns" after dedupe (on a partial re-import those differ; see
  // the repository's idempotency rule).
  rowCount: integer("row_count").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Canonical normalized transactions (see `Transaction` in `@ledger-lens/shared`). */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => statements.id, { onDelete: "cascade" }),
    transactionDate: date("transaction_date").notNull(),
    postedDate: date("posted_date"),
    description: text("description").notNull(),
    direction: text("direction").$type<Direction>().notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).$type<CurrencyCode>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    rawRow: jsonb("raw_row").$type<Record<string, string>>().notNull(),
    // Enrichment (Phase 2, ADR-0006). All nullable: NULL = not yet categorized;
    // any value (incl. "uncategorized") = done. The LLM assigns `category`;
    // `category_model` + `categorized_at` are kept for audit/eval.
    category: text("category").$type<Category>(),
    categoryModel: text("category_model"),
    categorizedAt: timestamp("categorized_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    // Idempotency: re-importing the same statement cannot duplicate a row.
    uniqueIndex("transactions_account_fingerprint_uq").on(table.accountId, table.fingerprint),
    // Account-scoped keyset pagination ordered by (transaction_date, id).
    index("transactions_account_date_id_idx").on(table.accountId, table.transactionDate, table.id),
  ],
);
