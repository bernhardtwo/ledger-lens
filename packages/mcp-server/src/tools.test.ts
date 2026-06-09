/**
 * Unit tests for the MCP tool handlers with `@ledger-lens/db` mocked — no
 * Postgres, no Docker, so they run under `pnpm check` (the integration coverage
 * against a real DB lives in tools.itest.ts). They pin the handler
 * responsibilities the transport must be able to rely on: DTO mapping, `raw_row`
 * exclusion, the not-found throw, the default/echo params, and that the account's
 * own currency seeds the deterministic Money aggregation.
 */
import type { Database, TransactionListRow } from "@ledger-lens/db";
import {
  getAccountById,
  listAccounts,
  listTransactionAmounts,
  listTransactions,
} from "@ledger-lens/db";
import type { AccountKind, Category, CurrencyCode, Direction } from "@ledger-lens/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleGetAccount,
  handleListAccounts,
  handleListTransactions,
  handleSpendingByCategory,
  handleSummarizeAccount,
} from "./tools.js";

vi.mock("@ledger-lens/db", () => ({
  getAccountById: vi.fn(),
  listAccounts: vi.fn(),
  listTransactions: vi.fn(),
  listTransactionAmounts: vi.fn(),
}));

const getAccountByIdMock = vi.mocked(getAccountById);
const listAccountsMock = vi.mocked(listAccounts);
const listTransactionsMock = vi.mocked(listTransactions);
const listTransactionAmountsMock = vi.mocked(listTransactionAmounts);

const db = {} as Database;
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_ID = "22222222-2222-4222-8222-222222222222";

/** The full `accounts` row shape (no extra columns — see schema.ts). */
interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly currencyCode: CurrencyCode;
  readonly kind: AccountKind;
}

const account = (currencyCode: CurrencyCode = "USD"): AccountRow => ({
  id: ACCOUNT_ID,
  name: "Checking",
  institution: "Test Bank",
  currencyCode,
  kind: "bank",
});

const txRow = (over: Partial<TransactionListRow> = {}): TransactionListRow => ({
  id: "t-1",
  accountId: ACCOUNT_ID,
  statementId: "s-1",
  transactionDate: "2026-05-01",
  postedDate: null,
  description: "WHOLE FOODS",
  direction: "debit",
  amountMinor: 3000n,
  currencyCode: "USD",
  fingerprint: "fp-1",
  category: "groceries",
  ...over,
});

const amount = (category: Category | null, direction: Direction, amountMinor: bigint) => ({
  category,
  direction,
  amountMinor,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleListAccounts", () => {
  it("maps rows to DTOs (currencyCode -> currency, no DB-only columns)", async () => {
    listAccountsMock.mockResolvedValue([account()]);
    const { accounts } = await handleListAccounts(db);
    expect(accounts).toEqual([
      { id: ACCOUNT_ID, name: "Checking", institution: "Test Bank", currency: "USD", kind: "bank" },
    ]);
    expect(accounts[0]).not.toHaveProperty("currencyCode");
  });
});

describe("handleGetAccount", () => {
  it("maps the found account to a DTO", async () => {
    getAccountByIdMock.mockResolvedValue(account("EUR"));
    expect(await handleGetAccount(db, { accountId: ACCOUNT_ID })).toEqual({
      id: ACCOUNT_ID,
      name: "Checking",
      institution: "Test Bank",
      currency: "EUR",
      kind: "bank",
    });
  });

  it("throws when the account does not exist", async () => {
    getAccountByIdMock.mockResolvedValue(null);
    await expect(handleGetAccount(db, { accountId: UNKNOWN_ID })).rejects.toThrow(/not found/);
  });
});

describe("handleListTransactions", () => {
  it("projects rows to items with a MoneyDTO + category and never a raw_row", async () => {
    getAccountByIdMock.mockResolvedValue(account());
    listTransactionsMock.mockResolvedValue({ items: [txRow()], nextCursor: "next" });

    const result = await handleListTransactions(db, { accountId: ACCOUNT_ID });

    expect(result.nextCursor).toBe("next");
    expect(result.items[0]).toMatchObject({
      id: "t-1",
      description: "WHOLE FOODS",
      direction: "debit",
      category: "groceries",
      amount: { amount: "3000", currency: "USD", minorUnitExponent: 2, decimal: "30.00" },
    });
    expect(result.items[0]).not.toHaveProperty("rawRow");
    expect(result.items[0]).not.toHaveProperty("amountMinor");
    expect(result.items[0]).not.toHaveProperty("currencyCode");
  });

  it("defaults limit/cursor and passes every filter through to the query", async () => {
    getAccountByIdMock.mockResolvedValue(account());
    listTransactionsMock.mockResolvedValue({ items: [], nextCursor: null });

    await handleListTransactions(db, {
      accountId: ACCOUNT_ID,
      category: "dining",
      direction: "debit",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });

    expect(listTransactionsMock).toHaveBeenCalledWith(db, {
      accountId: ACCOUNT_ID,
      limit: 50,
      cursor: null,
      category: "dining",
      direction: "debit",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });
  });

  it("throws on an unknown account without querying transactions", async () => {
    getAccountByIdMock.mockResolvedValue(null);
    await expect(handleListTransactions(db, { accountId: UNKNOWN_ID })).rejects.toThrow(
      /not found/,
    );
    expect(listTransactionsMock).not.toHaveBeenCalled();
  });
});

describe("handleSpendingByCategory", () => {
  it("seeds the account currency, echoes the range, and totals debits only", async () => {
    getAccountByIdMock.mockResolvedValue(account("EUR"));
    listTransactionAmountsMock.mockResolvedValue([
      amount("groceries", "debit", 3000n),
      amount("income", "credit", 250000n), // credit -> excluded from spending
    ]);

    const result = await handleSpendingByCategory(db, {
      accountId: ACCOUNT_ID,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });

    expect(listTransactionAmountsMock).toHaveBeenCalledWith(db, {
      accountId: ACCOUNT_ID,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });
    expect(result.currency).toBe("EUR");
    expect(result.dateFrom).toBe("2026-05-01");
    expect(result.dateTo).toBe("2026-05-31");
    expect(result.categories).toEqual([
      {
        category: "groceries",
        total: { amount: "3000", currency: "EUR", minorUnitExponent: 2, decimal: "30.00" },
        transactionCount: 1,
      },
    ]);
    expect(result.total).toEqual({
      amount: "3000",
      currency: "EUR",
      minorUnitExponent: 2,
      decimal: "30.00",
    });
  });

  it("echoes null dates when no range is given", async () => {
    getAccountByIdMock.mockResolvedValue(account());
    listTransactionAmountsMock.mockResolvedValue([]);
    const result = await handleSpendingByCategory(db, { accountId: ACCOUNT_ID });
    expect(result.dateFrom).toBeNull();
    expect(result.dateTo).toBeNull();
    expect(result.categories).toEqual([]);
  });

  it("throws on an unknown account", async () => {
    getAccountByIdMock.mockResolvedValue(null);
    await expect(handleSpendingByCategory(db, { accountId: UNKNOWN_ID })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("handleSummarizeAccount", () => {
  it("returns totals and a non-negative credit net seeded by the account currency", async () => {
    getAccountByIdMock.mockResolvedValue(account());
    listTransactionAmountsMock.mockResolvedValue([
      amount("income", "credit", 250000n),
      amount("groceries", "debit", 3000n),
    ]);

    const result = await handleSummarizeAccount(db, { accountId: ACCOUNT_ID });

    expect(result.totalIn).toEqual({
      amount: "250000",
      currency: "USD",
      minorUnitExponent: 2,
      decimal: "2500.00",
    });
    expect(result.totalOut).toEqual({
      amount: "3000",
      currency: "USD",
      minorUnitExponent: 2,
      decimal: "30.00",
    });
    expect(result.net).toEqual({
      direction: "credit",
      amount: { amount: "247000", currency: "USD", minorUnitExponent: 2, decimal: "2470.00" },
    });
    expect(result.transactionCount).toBe(2);
  });

  it("throws on an unknown account", async () => {
    getAccountByIdMock.mockResolvedValue(null);
    await expect(handleSummarizeAccount(db, { accountId: UNKNOWN_ID })).rejects.toThrow(
      /not found/,
    );
  });
});
