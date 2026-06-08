/**
 * Deterministic money aggregation folds (see ADR-0007, spec 0003).
 *
 * Pure functions over the shared `Money` value object — no DB, no LLM, no float.
 * Every sum is same-currency by construction (the account's currency), upholding
 * the single-currency-account invariant; outputs are `MoneyDTO` (never `bigint`).
 * SQL `SUM ... GROUP BY` is the later scale path; the fold keeps the money
 * boundary visible and unit-testable.
 */
import {
  type Category,
  type CurrencyCode,
  type Direction,
  type Money,
  type MoneyDTO,
  addMoney,
  compareMoney,
  money,
  subtractMoney,
  toMoneyDTO,
  zeroMoney,
} from "@ledger-lens/shared";

/** A minimal transaction row for aggregation. */
export interface AmountRow {
  readonly category: Category | null;
  readonly direction: Direction;
  readonly amountMinor: bigint;
}

/** Spending total for one category. */
export interface CategorySpending {
  readonly category: Category;
  readonly total: MoneyDTO;
  readonly transactionCount: number;
}

/** Output of {@link summarizeSpendingByCategory}. */
export interface SpendingSummary {
  readonly categories: readonly CategorySpending[];
  readonly total: MoneyDTO;
}

/** Output of {@link summarizeAccountFlow}. */
export interface AccountFlowSummary {
  readonly totalIn: MoneyDTO;
  readonly totalOut: MoneyDTO;
  readonly net: { readonly direction: Direction; readonly amount: MoneyDTO };
  readonly transactionCount: number;
}

/**
 * Total **debit** (spending) per category over the rows. Outflows only — folding
 * in credits would conflate refunds/income. A debit with no category buckets under
 * `uncategorized`. Sorted by total desc, then category for a stable order.
 */
export function summarizeSpendingByCategory(
  rows: readonly AmountRow[],
  currency: CurrencyCode,
): SpendingSummary {
  const buckets = new Map<Category, { total: Money; count: number }>();
  let grandTotal = zeroMoney(currency);

  for (const row of rows) {
    if (row.direction !== "debit") {
      continue;
    }
    const category: Category = row.category ?? "uncategorized";
    const amount = money(row.amountMinor, currency);
    const existing = buckets.get(category);
    buckets.set(
      category,
      existing
        ? { total: addMoney(existing.total, amount), count: existing.count + 1 }
        : { total: amount, count: 1 },
    );
    grandTotal = addMoney(grandTotal, amount);
  }

  const categories = [...buckets.entries()]
    .sort(([catA, a], [catB, b]) => compareMoney(b.total, a.total) || catA.localeCompare(catB))
    .map(([category, { total, count }]) => ({
      category,
      total: toMoneyDTO(total),
      transactionCount: count,
    }));

  return { categories, total: toMoneyDTO(grandTotal) };
}

/**
 * Net cash flow over the rows: `totalIn` (credits), `totalOut` (debits), and the
 * non-negative `net` as a `{ direction, amount }` pair (`credit` when inflow ≥
 * outflow, else `debit`).
 */
export function summarizeAccountFlow(
  rows: readonly AmountRow[],
  currency: CurrencyCode,
): AccountFlowSummary {
  let totalIn = zeroMoney(currency);
  let totalOut = zeroMoney(currency);

  for (const row of rows) {
    const amount = money(row.amountMinor, currency);
    if (row.direction === "credit") {
      totalIn = addMoney(totalIn, amount);
    } else {
      totalOut = addMoney(totalOut, amount);
    }
  }

  const net: { direction: Direction; amount: MoneyDTO } =
    compareMoney(totalIn, totalOut) >= 0
      ? { direction: "credit", amount: toMoneyDTO(subtractMoney(totalIn, totalOut)) }
      : { direction: "debit", amount: toMoneyDTO(subtractMoney(totalOut, totalIn)) };

  return {
    totalIn: toMoneyDTO(totalIn),
    totalOut: toMoneyDTO(totalOut),
    net,
    transactionCount: rows.length,
  };
}
