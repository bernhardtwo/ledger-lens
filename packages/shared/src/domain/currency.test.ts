import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, CurrencyCodeSchema, minorUnitExponentOf } from "./currency.js";

describe("currency registry", () => {
  it("knows the minor-unit exponent for each supported currency", () => {
    expect(minorUnitExponentOf("USD")).toBe(2);
    expect(minorUnitExponentOf("MXN")).toBe(2);
    expect(minorUnitExponentOf("COP")).toBe(2);
    expect(minorUnitExponentOf("JPY")).toBe(0); // no minor unit
    expect(minorUnitExponentOf("BHD")).toBe(3); // three-decimal currency
  });

  it("has an exponent for every code in the registry", () => {
    for (const code of CURRENCY_CODES) {
      expect(Number.isInteger(minorUnitExponentOf(code))).toBe(true);
    }
  });

  it("rejects unknown codes at the Zod boundary", () => {
    expect(CurrencyCodeSchema.safeParse("USD").success).toBe(true);
    expect(CurrencyCodeSchema.safeParse("ZZZ").success).toBe(false);
  });
});
