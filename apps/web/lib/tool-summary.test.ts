import { describe, expect, it } from "vitest";
import { toolInputSummary } from "./tool-summary";

describe("toolInputSummary", () => {
  it("shows a date range", () => {
    expect(toolInputSummary({ dateFrom: "2026-05-01", dateTo: "2026-05-31" })).toBe(
      "2026-05-01 → 2026-05-31",
    );
  });

  it("shows an open-ended from/through date", () => {
    expect(toolInputSummary({ dateFrom: "2026-05-01" })).toBe("from 2026-05-01");
    expect(toolInputSummary({ dateTo: "2026-05-31" })).toBe("through 2026-05-31");
  });

  it("shows category and direction (figure-free keys)", () => {
    expect(toolInputSummary({ category: "dining", direction: "debit" })).toBe("dining · debit");
  });

  it("shows a row limit (a count, not money)", () => {
    expect(toolInputSummary({ limit: 50 })).toBe("limit 50");
  });

  it("NEVER renders an unexpected/money-shaped field (determinism-first guard)", () => {
    const summary = toolInputSummary({
      accountId: "a",
      amount: "500000",
      minAmount: 500,
      total: 1234.56,
      balance: 9999,
    });
    expect(summary).toBe("");
    expect(summary).not.toMatch(/500|1234|9999/);
  });

  it("combines allow-listed keys and drops everything else", () => {
    const summary = toolInputSummary({
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      category: "groceries",
      amount: "12345", // money — must not appear
    });
    expect(summary).toBe("2026-05-01 → 2026-05-31 · groceries");
    expect(summary).not.toContain("12345");
  });
});
