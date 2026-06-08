import { describe, expect, it } from "vitest";
import {
  type AmountRow,
  summarizeAccountFlow,
  summarizeSpendingByCategory,
} from "./aggregation.js";

const USD = "USD" as const;
const usd = (amount: string) => ({ amount, currency: "USD", minorUnitExponent: 2 });

function row(
  category: AmountRow["category"],
  direction: AmountRow["direction"],
  amountMinor: bigint,
): AmountRow {
  return { category, direction, amountMinor };
}

describe("summarizeSpendingByCategory", () => {
  it("sums debits per category, ignores credits, sorts by total desc", () => {
    const out = summarizeSpendingByCategory(
      [
        row("dining", "debit", 500n),
        row("dining", "debit", 1500n),
        row("groceries", "debit", 3000n),
        row("income", "credit", 250000n), // credit -> not spending
      ],
      USD,
    );
    expect(out.categories).toEqual([
      { category: "groceries", total: usd("3000"), transactionCount: 1 },
      { category: "dining", total: usd("2000"), transactionCount: 2 },
    ]);
    expect(out.total).toEqual(usd("5000"));
  });

  it("breaks equal totals by category name for a stable order", () => {
    const out = summarizeSpendingByCategory(
      [row("shopping", "debit", 1000n), row("dining", "debit", 1000n)],
      USD,
    );
    expect(out.categories.map((c) => c.category)).toEqual(["dining", "shopping"]);
  });

  it("buckets a null category under uncategorized", () => {
    const out = summarizeSpendingByCategory([row(null, "debit", 700n)], USD);
    expect(out.categories[0]?.category).toBe("uncategorized");
    expect(out.categories[0]?.total).toEqual(usd("700"));
  });

  it("returns no categories and a zero total when there are no debits", () => {
    const out = summarizeSpendingByCategory([row("income", "credit", 100n)], USD);
    expect(out.categories).toEqual([]);
    expect(out.total).toEqual(usd("0"));
  });

  it("handles an empty input", () => {
    const out = summarizeSpendingByCategory([], USD);
    expect(out.categories).toEqual([]);
    expect(out.total).toEqual(usd("0"));
  });
});

describe("summarizeAccountFlow", () => {
  it("computes totals and a credit net when inflow exceeds outflow", () => {
    const out = summarizeAccountFlow(
      [
        row("income", "credit", 250000n),
        row("dining", "debit", 500n),
        row("groceries", "debit", 3000n),
      ],
      USD,
    );
    expect(out.totalIn).toEqual(usd("250000"));
    expect(out.totalOut).toEqual(usd("3500"));
    expect(out.net).toEqual({ direction: "credit", amount: usd("246500") });
    expect(out.transactionCount).toBe(3);
  });

  it("computes a debit net when outflow exceeds inflow", () => {
    const out = summarizeAccountFlow(
      [row("income", "credit", 1000n), row("shopping", "debit", 5000n)],
      USD,
    );
    expect(out.net).toEqual({ direction: "debit", amount: usd("4000") });
  });

  it("nets to credit-zero when inflow equals outflow", () => {
    const out = summarizeAccountFlow(
      [row("income", "credit", 1000n), row("shopping", "debit", 1000n)],
      USD,
    );
    expect(out.net).toEqual({ direction: "credit", amount: usd("0") });
  });

  it("handles an empty input (all zero)", () => {
    const out = summarizeAccountFlow([], USD);
    expect(out.totalIn).toEqual(usd("0"));
    expect(out.totalOut).toEqual(usd("0"));
    expect(out.net).toEqual({ direction: "credit", amount: usd("0") });
    expect(out.transactionCount).toBe(0);
  });
});
