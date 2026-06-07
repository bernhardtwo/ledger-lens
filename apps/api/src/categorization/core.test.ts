import { describe, expect, it } from "vitest";
import { categorizeBatch, categorizeTransactions } from "./core.js";
import type { CategorizableTransaction, CategorizationClient } from "./types.js";

function tx(id: string, description = "X"): CategorizableTransaction {
  return { id, description, direction: "debit", amountMinor: 100n, currencyCode: "USD" };
}

function mockClient(categorize: CategorizationClient["categorize"]): CategorizationClient {
  return { modelId: "mock", categorize };
}

describe("categorizeTransactions — batching", () => {
  it("splits into sequential batches of the configured size", async () => {
    const txns = Array.from({ length: 120 }, (_, i) => tx(String(i + 1)));
    const batchSizes: number[] = [];
    const client = mockClient(async (items) => {
      batchSizes.push(items.length);
      return {
        categorizations: items.map((item) => ({ index: item.index, category: "shopping" })),
      };
    });

    const run = await categorizeTransactions(txns, client, 50);
    expect(batchSizes).toEqual([50, 50, 20]);
    expect(run.assignments.size).toBe(120);
  });
});

describe("categorizeBatch — validation, reconciliation, fallback", () => {
  it("maps validated categories back to ids by index", async () => {
    const client = mockClient(async (items) => ({
      categorizations: items.map((item) => ({
        index: item.index,
        category: item.index === 1 ? "dining" : "shopping",
      })),
    }));
    const result = await categorizeBatch([tx("a"), tx("b"), tx("c")], client);
    expect(result.get("a")).toBe("dining");
    expect(result.get("b")).toBe("shopping");
    expect(result.get("c")).toBe("shopping");
  });

  it("does not trust order — reconciles by index", async () => {
    const client = mockClient(async (items) => ({
      // Same indices, reversed order; index 3 -> travel.
      categorizations: [...items].reverse().map((item) => ({
        index: item.index,
        category: item.index === 3 ? "travel" : "groceries",
      })),
    }));
    const result = await categorizeBatch([tx("a"), tx("b"), tx("c")], client);
    expect(result.get("c")).toBe("travel");
    expect(result.get("a")).toBe("groceries");
  });

  it("falls back to uncategorized for an off-taxonomy label", async () => {
    const client = mockClient(async (items) => ({
      categorizations: items.map((item) => ({ index: item.index, category: "crypto" })),
    }));
    const result = await categorizeBatch([tx("a")], client);
    expect(result.get("a")).toBe("uncategorized");
  });

  it("leaves an uncovered index as uncategorized", async () => {
    const client = mockClient(async () => ({
      categorizations: [{ index: 1, category: "dining" }],
    }));
    const result = await categorizeBatch([tx("a"), tx("b")], client);
    expect(result.get("a")).toBe("dining");
    expect(result.get("b")).toBe("uncategorized");
  });

  it("ignores a hallucinated out-of-range index", async () => {
    const client = mockClient(async () => ({
      categorizations: [
        { index: 1, category: "dining" },
        { index: 99, category: "fees" },
      ],
    }));
    const result = await categorizeBatch([tx("a")], client);
    expect(result.get("a")).toBe("dining");
    expect(result.size).toBe(1);
  });

  it("degrades the whole batch to uncategorized on unparseable output", async () => {
    const client = mockClient(async () => null);
    const result = await categorizeBatch([tx("a"), tx("b")], client);
    expect([...result.values()]).toEqual(["uncategorized", "uncategorized"]);
  });
});

describe("categorizeTransactions — failure isolation", () => {
  it("records a transport-failed batch in failedIds (rows left for retry)", async () => {
    const client = mockClient(async () => {
      throw new Error("network down");
    });
    const run = await categorizeTransactions([tx("a"), tx("b")], client, 50);
    expect(run.assignments.size).toBe(0);
    expect(run.failedIds).toEqual(["a", "b"]);
  });

  it("isolates a failed batch from successful ones", async () => {
    let call = 0;
    const client = mockClient(async (items) => {
      call += 1;
      if (call === 1) {
        throw new Error("boom");
      }
      return { categorizations: items.map((item) => ({ index: item.index, category: "fees" })) };
    });
    const run = await categorizeTransactions([tx("a"), tx("b")], client, 1);
    expect(run.failedIds).toEqual(["a"]);
    expect(run.assignments.get("b")).toBe("fees");
  });
});
