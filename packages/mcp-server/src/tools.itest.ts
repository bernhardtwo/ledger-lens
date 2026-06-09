/**
 * Integration tests for the MCP tool handlers (see spec 0003). Calls the handlers
 * directly in-process against a disposable Postgres with persisted + categorized
 * data — no MCP client/transport, no agent, no LLM, no network.
 */
import { randomUUID } from "node:crypto";
import {
  type Database,
  type DatabaseConnection,
  SEED_ACCOUNTS,
  accounts,
  applyCategorizations,
  applyMigrations,
  createDatabase,
  listTransactions,
  persistIngestion,
  seedAccounts,
} from "@ledger-lens/db";
import {
  type Category,
  type Direction,
  type Money,
  type TransactionDraft,
  isoDate,
  money,
} from "@ledger-lens/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccountSummaryOutputSchema,
  ListTransactionsOutputSchema,
  SpendingByCategoryOutputSchema,
} from "./schemas.js";
import {
  handleGetAccount,
  handleListAccounts,
  handleListTransactions,
  handleSpendingByCategory,
  handleSummarizeAccount,
} from "./tools.js";

let container: StartedPostgreSqlContainer;
let connection: DatabaseConnection;
let db: Database;
let accountId: string;

interface Fixture {
  readonly date: string;
  readonly description: string;
  readonly direction: Direction;
  readonly amountMinor: bigint;
  readonly category: Category;
}

// One account's worth of categorized transactions (USD).
const FIXTURES: readonly Fixture[] = [
  {
    date: "2026-05-01",
    description: "WHOLE FOODS",
    direction: "debit",
    amountMinor: 3000n,
    category: "groceries",
  },
  {
    date: "2026-05-02",
    description: "COFFEE BAR",
    direction: "debit",
    amountMinor: 500n,
    category: "dining",
  },
  {
    date: "2026-05-03",
    description: "RESTAURANT",
    direction: "debit",
    amountMinor: 1500n,
    category: "dining",
  },
  {
    date: "2026-05-04",
    description: "ACME PAYROLL",
    direction: "credit",
    amountMinor: 250000n,
    category: "income",
  },
  {
    date: "2026-05-10",
    description: "ELECTRONICS",
    direction: "debit",
    amountMinor: 2000n,
    category: "shopping",
  },
];

function toDraft(account: string, fixture: Fixture, index: number): TransactionDraft {
  const amount: Money = money(fixture.amountMinor, "USD");
  return {
    accountId: account,
    transactionDate: isoDate(fixture.date),
    postedDate: null,
    description: fixture.description,
    direction: fixture.direction,
    amount,
    fingerprint: `fp-${index}`,
    rawRow: { Description: fixture.description },
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  connection = createDatabase(container.getConnectionUri());
  db = connection.db;
  await applyMigrations(db);
  await seedAccounts(db);

  accountId = randomUUID();
  await db.insert(accounts).values({
    id: accountId,
    name: "MCP Test Account",
    institution: "Test Bank",
    currencyCode: "USD",
    kind: "bank",
  });

  await persistIngestion(db, {
    accountId,
    sourceFilename: "fixtures.csv",
    profileId: "bank-a@v1",
    accepted: FIXTURES.map((fixture, index) => toDraft(accountId, fixture, index)),
  });

  // Categorize the persisted rows by their (unique) descriptions.
  const categoryByDescription = new Map<string, Category>(
    FIXTURES.map((fixture) => [fixture.description, fixture.category]),
  );
  const persisted = await listTransactions(db, { accountId, limit: 200 });
  await applyCategorizations(
    db,
    persisted.items.map((item) => ({
      id: item.id,
      category: categoryByDescription.get(item.description) ?? "uncategorized",
    })),
    "test",
    new Date(),
  );
}, 180_000);

afterAll(async () => {
  await connection?.client.end();
  await container?.stop();
});

describe("list_accounts / get_account", () => {
  it("lists accounts (seeded + test) with currency mapped", async () => {
    const { accounts } = await handleListAccounts(db);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    for (const seed of SEED_ACCOUNTS) {
      expect(byId.get(seed.id)?.currency).toBe(seed.currency);
    }
    expect(byId.get(accountId)?.currency).toBe("USD");
  });

  it("gets one account and errors on an unknown id", async () => {
    const seed = SEED_ACCOUNTS[0];
    const account = await handleGetAccount(db, { accountId: seed.id });
    expect(account).toMatchObject({ id: seed.id, currency: seed.currency, kind: seed.kind });

    await expect(handleGetAccount(db, { accountId: randomUUID() })).rejects.toThrow(/not found/);
  });
});

describe("list_transactions", () => {
  it("returns the account's transactions (no raw_row), ordered, with category + MoneyDTO", async () => {
    const result = await handleListTransactions(db, { accountId });
    expect(ListTransactionsOutputSchema.safeParse(result).success).toBe(true);
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({
      transactionDate: "2026-05-01",
      description: "WHOLE FOODS",
      direction: "debit",
      category: "groceries",
      amount: { amount: "3000", currency: "USD", minorUnitExponent: 2, decimal: "30.00" },
    });
    expect(result.items[0]).not.toHaveProperty("rawRow");
  });

  it("filters by category, direction, and date range", async () => {
    const dining = await handleListTransactions(db, { accountId, category: "dining" });
    expect(dining.items.map((i) => i.description)).toEqual(["COFFEE BAR", "RESTAURANT"]);

    const debits = await handleListTransactions(db, { accountId, direction: "debit" });
    expect(debits.items).toHaveLength(4);

    const earlyMay = await handleListTransactions(db, {
      accountId,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-04",
    });
    expect(earlyMay.items).toHaveLength(4); // excludes the 05-10 row
  });

  it("paginates with a working cursor", async () => {
    const page1 = await handleListTransactions(db, { accountId, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await handleListTransactions(db, {
      accountId,
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items[0]?.transactionDate).toBe("2026-05-03");
  });

  it("errors on an unknown account", async () => {
    await expect(handleListTransactions(db, { accountId: randomUUID() })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("summarize_spending_by_category", () => {
  it("totals debits per category (sorted), excluding credits", async () => {
    const result = await handleSpendingByCategory(db, { accountId });
    expect(SpendingByCategoryOutputSchema.safeParse(result).success).toBe(true);
    expect(result.currency).toBe("USD");
    expect(result.categories).toEqual([
      {
        category: "groceries",
        total: { amount: "3000", currency: "USD", minorUnitExponent: 2, decimal: "30.00" },
        transactionCount: 1,
      },
      {
        category: "dining",
        total: { amount: "2000", currency: "USD", minorUnitExponent: 2, decimal: "20.00" },
        transactionCount: 2,
      },
      {
        category: "shopping",
        total: { amount: "2000", currency: "USD", minorUnitExponent: 2, decimal: "20.00" },
        transactionCount: 1,
      },
    ]);
    expect(result.total).toEqual({
      amount: "7000",
      currency: "USD",
      minorUnitExponent: 2,
      decimal: "70.00",
    });
  });

  it("honours the date range", async () => {
    const result = await handleSpendingByCategory(db, {
      accountId,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-03",
    });
    expect(result.categories).toEqual([
      {
        category: "groceries",
        total: { amount: "3000", currency: "USD", minorUnitExponent: 2, decimal: "30.00" },
        transactionCount: 1,
      },
      {
        category: "dining",
        total: { amount: "2000", currency: "USD", minorUnitExponent: 2, decimal: "20.00" },
        transactionCount: 2,
      },
    ]);
    expect(result.total).toEqual({
      amount: "5000",
      currency: "USD",
      minorUnitExponent: 2,
      decimal: "50.00",
    });
  });
});

describe("summarize_account", () => {
  it("computes totals and a non-negative net (credit)", async () => {
    const result = await handleSummarizeAccount(db, { accountId });
    expect(AccountSummaryOutputSchema.safeParse(result).success).toBe(true);
    expect(result.totalIn).toEqual({
      amount: "250000",
      currency: "USD",
      minorUnitExponent: 2,
      decimal: "2500.00",
    });
    expect(result.totalOut).toEqual({
      amount: "7000",
      currency: "USD",
      minorUnitExponent: 2,
      decimal: "70.00",
    });
    expect(result.net).toEqual({
      direction: "credit",
      amount: { amount: "243000", currency: "USD", minorUnitExponent: 2, decimal: "2430.00" },
    });
    expect(result.transactionCount).toBe(5);
  });

  it("errors on an unknown account", async () => {
    await expect(handleSummarizeAccount(db, { accountId: randomUUID() })).rejects.toThrow(
      /not found/,
    );
  });
});
