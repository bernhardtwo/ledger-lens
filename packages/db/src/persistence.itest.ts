/**
 * Persistence integration tests for `@ledger-lens/db` (see spec 0001).
 *
 * Self-contained: builds `TransactionDraft`s directly (no ingestion dependency),
 * so the db package owns its own integration test. Runs against a disposable
 * Postgres via testcontainers.
 */
import { randomUUID } from "node:crypto";
import {
  type Direction,
  type Money,
  type TransactionDraft,
  isoDate,
  money,
} from "@ledger-lens/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, type DatabaseConnection, createDatabase } from "./client.js";
import { applyMigrations } from "./migrate.js";
import { getTransactionById, listTransactions, persistIngestion } from "./repository.js";
import { accounts, statements, transactions } from "./schema.js";
import { SEED_ACCOUNTS, seedAccounts } from "./seed.js";

let container: StartedPostgreSqlContainer;
let connection: DatabaseConnection;
let db: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  connection = createDatabase(container.getConnectionUri());
  db = connection.db;
  await applyMigrations(db);
  await seedAccounts(db);
}, 180_000);

afterAll(async () => {
  await connection?.client.end();
  await container?.stop();
});

/** Insert a throwaway account so each test is isolated by account id. */
async function freshAccount(currency: "USD" | "EUR" = "USD"): Promise<string> {
  const id = randomUUID();
  await db.insert(accounts).values({
    id,
    name: "Test Account",
    institution: "Test Bank",
    currencyCode: currency,
    kind: "bank",
  });
  return id;
}

interface DraftOptions {
  readonly accountId: string;
  readonly transactionDate: string;
  readonly postedDate?: string;
  readonly description: string;
  readonly direction: Direction;
  readonly amount: Money;
  readonly fingerprint: string;
}

/** Build a `TransactionDraft` directly — no ingestion involved. */
function draft(options: DraftOptions): TransactionDraft {
  return {
    accountId: options.accountId,
    transactionDate: isoDate(options.transactionDate),
    postedDate: options.postedDate === undefined ? null : isoDate(options.postedDate),
    description: options.description,
    direction: options.direction,
    amount: options.amount,
    fingerprint: options.fingerprint,
    rawRow: { Description: options.description },
  };
}

/** The bank-a fixture, as drafts: a $5 debit and a $1,200 credit. */
function bankADrafts(accountId: string): TransactionDraft[] {
  return [
    draft({
      accountId,
      transactionDate: "2026-05-01",
      description: "COFFEE BAR #12",
      direction: "debit",
      amount: money(500n, "USD"),
      fingerprint: "fp-coffee",
    }),
    draft({
      accountId,
      transactionDate: "2026-05-02",
      description: "ACME PAYROLL",
      direction: "credit",
      amount: money(120000n, "USD"),
      fingerprint: "fp-acme",
    }),
  ];
}

describe("migrations & seed", () => {
  it("applies migrations cleanly and seeds the fixed accounts", async () => {
    const rows = await db.select().from(accounts);
    const ids = new Set(rows.map((row) => row.id));
    for (const seed of SEED_ACCOUNTS) {
      expect(ids.has(seed.id)).toBe(true);
    }
  });
});

describe("persistIngestion — mapping", () => {
  it("persists a statement and its transactions with exact column mapping", async () => {
    const accountId = await freshAccount("USD");
    const result = await persistIngestion(db, {
      accountId,
      sourceFilename: "bank-a.csv",
      profileId: "bank-a@v1",
      accepted: bankADrafts(accountId),
    });
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.statementId).not.toBeNull();

    const statementRows = await db
      .select()
      .from(statements)
      .where(eq(statements.accountId, accountId));
    expect(statementRows).toHaveLength(1);
    expect(statementRows[0]?.rowCount).toBe(2);

    const txns = await listTransactions(db, { accountId, limit: 10 });
    const coffee = txns.items[0];
    expect(coffee?.transactionDate).toBe("2026-05-01");
    expect(coffee?.postedDate).toBeNull();
    expect(coffee?.direction).toBe("debit");
    expect(coffee?.amountMinor).toBe(500n);
    expect(coffee?.currencyCode).toBe("USD");
    expect(coffee?.category).toBeNull();

    const payroll = txns.items[1];
    expect(payroll?.direction).toBe("credit");
    expect(payroll?.amountMinor).toBe(120000n);
  });

  it("persists dual dates (a distinct posting date) in EUR", async () => {
    const accountId = await freshAccount("EUR");
    const result = await persistIngestion(db, {
      accountId,
      sourceFilename: "banco-b.csv",
      profileId: "banco-b@v1",
      accepted: [
        draft({
          accountId,
          transactionDate: "2026-05-01",
          postedDate: "2026-05-03",
          description: "PAGO TARJETA",
          direction: "debit",
          amount: money(123450n, "EUR"),
          fingerprint: "fp-cargo",
        }),
      ],
    });
    expect(result.inserted).toBe(1);

    const txns = await listTransactions(db, { accountId, limit: 10 });
    const cargo = txns.items[0];
    expect(cargo?.transactionDate).toBe("2026-05-01");
    expect(cargo?.postedDate).toBe("2026-05-03");
    expect(cargo?.amountMinor).toBe(123450n);
    expect(cargo?.currencyCode).toBe("EUR");
  });
});

describe("persistIngestion — idempotency", () => {
  it("re-importing the same statement inserts no duplicates and leaves no orphan statement", async () => {
    const accountId = await freshAccount("USD");
    const first = await persistIngestion(db, {
      accountId,
      sourceFilename: "bank-a.csv",
      profileId: "bank-a@v1",
      accepted: bankADrafts(accountId),
    });
    expect(first.inserted).toBe(2);

    const second = await persistIngestion(db, {
      accountId,
      sourceFilename: "bank-a.csv",
      profileId: "bank-a@v1",
      accepted: bankADrafts(accountId),
    });
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.statementId).toBeNull();

    const statementRows = await db
      .select()
      .from(statements)
      .where(eq(statements.accountId, accountId));
    expect(statementRows).toHaveLength(1);

    const txnRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    expect(txnRows).toHaveLength(2);
  });

  it("keeps two legitimately-identical rows (distinct fingerprints) both", async () => {
    const accountId = await freshAccount("USD");
    const identical = (fingerprint: string): TransactionDraft =>
      draft({
        accountId,
        transactionDate: "2026-05-01",
        description: "COFFEE BAR #12",
        direction: "debit",
        amount: money(500n, "USD"),
        fingerprint,
      });
    const result = await persistIngestion(db, {
      accountId,
      sourceFilename: "dups.csv",
      profileId: "bank-a@v1",
      accepted: [identical("fp-dup-0"), identical("fp-dup-1")],
    });
    expect(result.inserted).toBe(2);

    const txnRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    expect(txnRows).toHaveLength(2);
  });

  it("handles two concurrent imports of the same file safely", async () => {
    const accountId = await freshAccount("USD");
    const persist = () =>
      persistIngestion(db, {
        accountId,
        sourceFilename: "bank-a.csv",
        profileId: "bank-a@v1",
        accepted: bankADrafts(accountId),
      });

    const [a, b] = await Promise.all([persist(), persist()]);
    expect(a.inserted + b.inserted).toBe(2);

    const statementRows = await db
      .select()
      .from(statements)
      .where(eq(statements.accountId, accountId));
    expect(statementRows).toHaveLength(1);

    const txnRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    expect(txnRows).toHaveLength(2);
  });
});

describe("listTransactions — keyset pagination", () => {
  it("returns stable, ordered pages with a correct cursor", async () => {
    const accountId = await freshAccount("USD");
    await persistIngestion(db, {
      accountId,
      sourceFilename: "bank-a.csv",
      profileId: "bank-a@v1",
      accepted: bankADrafts(accountId),
    });

    const page1 = await listTransactions(db, { accountId, limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]?.transactionDate).toBe("2026-05-01");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listTransactions(db, { accountId, limit: 1, cursor: page1.nextCursor });
    expect(page2.items[0]?.transactionDate).toBe("2026-05-02");
    expect(page2.nextCursor).toBeNull();
  });
});

describe("raw_row projection", () => {
  it("excludes raw_row from the list projection but exposes it on an audit fetch", async () => {
    const accountId = await freshAccount("USD");
    await persistIngestion(db, {
      accountId,
      sourceFilename: "bank-a.csv",
      profileId: "bank-a@v1",
      accepted: bankADrafts(accountId),
    });

    const { items } = await listTransactions(db, { accountId, limit: 10 });
    const first = items[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    expect("rawRow" in first).toBe(false);

    const audit = await getTransactionById(db, accountId, first.id);
    expect(audit).not.toBeNull();
    expect(audit?.rawRow).toMatchObject({ Description: "COFFEE BAR #12" });
  });

  it("does not expose a transaction to a different account (audit fetch is account-scoped)", async () => {
    const ownerId = await freshAccount("USD");
    await persistIngestion(db, {
      accountId: ownerId,
      sourceFilename: "bank-a.csv",
      profileId: "bank-a@v1",
      accepted: bankADrafts(ownerId),
    });
    const { items } = await listTransactions(db, { accountId: ownerId, limit: 1 });
    const txnId = items[0]?.id;
    expect(txnId).toBeDefined();
    if (!txnId) {
      return;
    }
    const otherId = await freshAccount("USD");
    expect(await getTransactionById(db, otherId, txnId)).toBeNull();
  });
});
