/**
 * Compute a case's ground truth from the deterministic seed (see spec 0005), using
 * the **same money folds the MCP tools use** (`@ledger-lens/mcp-server`). This is
 * the bridge for the consistency test: it recomputes each case's figure from
 * `DEMO_SEED` and asserts it equals the committed `groundTruth`, so the dataset can
 * never silently drift from the seed — and the eval's notion of "truth" is exactly
 * the tools' math.
 *
 * Not exported from the package entry: only the consistency test uses it, so
 * `@ledger-lens/mcp-server` stays a devDependency of this package.
 */
import type { DemoSeedRow } from "@ledger-lens/db";
import {
  type AmountRow,
  summarizeAccountFlow,
  summarizeSpendingByCategory,
} from "@ledger-lens/mcp-server";
import type { CurrencyCode } from "@ledger-lens/shared";
import type { Derivation, GroundTruth } from "./dataset.js";

function inRange(date: string, from?: string, to?: string): boolean {
  if (from !== undefined && date < from) {
    return false;
  }
  if (to !== undefined && date > to) {
    return false;
  }
  return true;
}

function toAmountRows(rows: readonly DemoSeedRow[], from?: string, to?: string): AmountRow[] {
  return rows
    .filter((row) => inRange(row.date, from, to))
    .map((row) => ({
      category: row.category,
      direction: row.direction,
      amountMinor: row.amountMinor,
    }));
}

/** Recompute a case's expected ground truth from its account's seed rows. */
export function computeGroundTruth(
  rows: readonly DemoSeedRow[],
  currency: CurrencyCode,
  derivation: Derivation,
): GroundTruth {
  const { metric, dateFrom, dateTo, category } = derivation;
  const amounts = toAmountRows(rows, dateFrom, dateTo);

  switch (metric) {
    case "net":
      return { kind: "figure", money: summarizeAccountFlow(amounts, currency).net.amount };
    case "totalIn":
      return { kind: "figure", money: summarizeAccountFlow(amounts, currency).totalIn };
    case "totalOut":
      return { kind: "figure", money: summarizeAccountFlow(amounts, currency).totalOut };
    case "categorySpend": {
      const summary = summarizeSpendingByCategory(amounts, currency);
      const bucket = summary.categories.find((entry) => entry.category === category);
      if (bucket === undefined) {
        throw new Error(`no spending for category ${String(category)} in the derived range`);
      }
      return { kind: "figure", money: bucket.total };
    }
    case "topCategoryAmount": {
      const top = summarizeSpendingByCategory(amounts, currency).categories[0];
      if (top === undefined) {
        throw new Error("no spending in the derived range");
      }
      return { kind: "figure", money: top.total };
    }
    case "topCategoryName": {
      const top = summarizeSpendingByCategory(amounts, currency).categories[0];
      if (top === undefined) {
        throw new Error("no spending in the derived range");
      }
      return { kind: "text", contains: [top.category] };
    }
    case "none":
      return { kind: "refusal" };
    default: {
      const exhaustive: never = metric;
      throw new Error(`unhandled derivation metric: ${String(exhaustive)}`);
    }
  }
}
