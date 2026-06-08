import { describe, expect, it } from "vitest";
import { AccountIdInputSchema, ListTransactionsInputSchema, RangeInputSchema } from "./schemas.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("tool input schemas", () => {
  it("rejects a non-uuid accountId", () => {
    expect(AccountIdInputSchema.safeParse({ accountId: "nope" }).success).toBe(false);
    expect(ListTransactionsInputSchema.safeParse({ accountId: "nope" }).success).toBe(false);
  });

  it("rejects an out-of-range limit, a malformed date, and off-enum filters", () => {
    expect(ListTransactionsInputSchema.safeParse({ accountId: UUID, limit: 0 }).success).toBe(
      false,
    );
    expect(ListTransactionsInputSchema.safeParse({ accountId: UUID, limit: 999 }).success).toBe(
      false,
    );
    expect(
      ListTransactionsInputSchema.safeParse({ accountId: UUID, dateFrom: "2026-13-40" }).success,
    ).toBe(false);
    expect(
      ListTransactionsInputSchema.safeParse({ accountId: UUID, category: "crypto" }).success,
    ).toBe(false);
    expect(
      ListTransactionsInputSchema.safeParse({ accountId: UUID, direction: "sideways" }).success,
    ).toBe(false);
  });

  it("accepts a valid minimal input", () => {
    expect(RangeInputSchema.safeParse({ accountId: UUID }).success).toBe(true);
    expect(ListTransactionsInputSchema.safeParse({ accountId: UUID, limit: 50 }).success).toBe(
      true,
    );
  });
});
