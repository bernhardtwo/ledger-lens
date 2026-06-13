import type { MoneyDTO } from "@ledger-lens/shared";
import { describe, expect, it } from "vitest";
import { moneyDisplay } from "./money-format";

const usd = (amount: string): MoneyDTO => ({ amount, currency: "USD", minorUnitExponent: 2 });

describe("moneyDisplay (determinism-first)", () => {
  it("renders the exact decimal via the shared helper, never via Number()", () => {
    // Beyond 2^53 — a float path would lose precision; the bigint path stays exact.
    expect(moneyDisplay(usd("12345678901234567890"), "credit").text).toBe(
      "+USD 123456789012345678.90",
    );
  });

  it("signs and colours a debit (money out) with -/rose", () => {
    expect(moneyDisplay(usd("12500"), "debit")).toEqual({
      text: "-USD 125.00",
      tone: "text-rose-600",
    });
  });

  it("signs and colours a credit (money in) with +/emerald", () => {
    expect(moneyDisplay(usd("500000"), "credit")).toEqual({
      text: "+USD 5000.00",
      tone: "text-emerald-600",
    });
  });

  it("honours each currency's minor-unit exponent (EUR exp 2)", () => {
    expect(
      moneyDisplay({ amount: "999", currency: "EUR", minorUnitExponent: 2 }, "debit").text,
    ).toBe("-EUR 9.99");
  });
});
