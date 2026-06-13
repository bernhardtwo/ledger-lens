import "@testing-library/jest-dom/vitest";
import { isoDate } from "@ledger-lens/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionListItemResponse } from "../lib/contracts";
import { TransactionsTable } from "./TransactionsTable";

const fetchMock = vi.fn();
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ACCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STMT = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

// Fixtures must satisfy the shared schema (e.g. uuid ids), since the table validates
// the response at the client boundary just like production.
function tx(over: Partial<TransactionListItemResponse>): TransactionListItemResponse {
  return {
    id: ID1,
    accountId: ACCT,
    statementId: STMT,
    transactionDate: isoDate("2026-05-02"),
    postedDate: null,
    description: "WHOLE FOODS",
    direction: "debit",
    amount: { amount: "12500", currency: "USD", minorUnitExponent: 2 },
    fingerprint: "f1",
    category: "groceries",
    ...over,
  };
}

describe("TransactionsTable", () => {
  it("renders rows: money via the shared helper, null category as 'Uncategorized'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        items: [
          tx({ id: ID1, description: "WHOLE FOODS", direction: "debit", category: "groceries" }),
          tx({
            id: ID2,
            description: "ACME PAYROLL",
            direction: "credit",
            category: null,
            amount: { amount: "500000", currency: "USD", minorUnitExponent: 2 },
          }),
        ],
        nextCursor: null,
      }),
    );
    render(<TransactionsTable accountId={ACCT} />);

    expect(await screen.findByText("WHOLE FOODS")).toBeInTheDocument();
    expect(screen.getByText("groceries")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    // Money is rendered only via the shared decimal helper (debit -, credit +).
    expect(screen.getByText("-USD 125.00")).toBeInTheDocument();
    expect(screen.getByText("+USD 5000.00")).toBeInTheDocument();
    expect(screen.getByText("End of list")).toBeInTheDocument();
  });

  it("appends the next page on 'Load more' and stops when nextCursor is null", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonRes({ items: [tx({ id: ID1, description: "ROW ONE" })], nextCursor: "cur2" }),
      )
      .mockResolvedValueOnce(
        jsonRes({ items: [tx({ id: ID2, description: "ROW TWO" })], nextCursor: null }),
      );
    render(<TransactionsTable accountId={ACCT} />);

    await screen.findByText("ROW ONE");
    fireEvent.click(screen.getByText("Load more"));

    expect(await screen.findByText("ROW TWO")).toBeInTheDocument();
    expect(screen.getByText("ROW ONE")).toBeInTheDocument(); // appended, not replaced
    expect(screen.getByText("End of list")).toBeInTheDocument();
    // the second page used the opaque cursor from the first
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=cur2");
  });

  it("keeps existing rows and surfaces an error when a later page fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonRes({ items: [tx({ id: ID1, description: "ROW ONE" })], nextCursor: "cur2" }),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: "server boom" }),
      } as unknown as Response);
    render(<TransactionsTable accountId={ACCT} />);

    await screen.findByText("ROW ONE");
    fireEvent.click(screen.getByText("Load more"));

    expect(await screen.findByText("server boom")).toBeInTheDocument();
    expect(screen.getByText("ROW ONE")).toBeInTheDocument(); // preserved, not cleared
    expect(screen.getByText("Load more")).toBeInTheDocument(); // retry still offered
  });

  it("shows the empty state when there are no rows", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ items: [], nextCursor: null }));
    render(<TransactionsTable accountId={ACCT} />);
    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument();
  });
});
