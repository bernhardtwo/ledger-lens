import { describe, expect, it } from "vitest";
import {
  MoneyError,
  MoneySchema,
  addMoney,
  compareMoney,
  fromDecimalString,
  money,
  subtractMoney,
  toDecimalString,
  toMoneyDTO,
  zeroMoney,
} from "./money.js";

describe("money construction", () => {
  it("builds non-negative amounts and derives the exponent", () => {
    const m = money(123456n, "USD");
    expect(m.amount).toBe(123456n);
    expect(m.minorUnitExponent).toBe(2);
  });

  it("rejects negative magnitudes (sign lives on direction)", () => {
    expect(() => money(-1n, "USD")).toThrow(MoneyError);
  });

  it("exposes a zero constructor", () => {
    expect(zeroMoney("EUR").amount).toBe(0n);
  });
});

describe("fromDecimalString / toDecimalString", () => {
  it("parses across exponents 0, 2 and 3", () => {
    expect(fromDecimalString("1234.56", "USD").amount).toBe(123456n);
    expect(fromDecimalString("1234", "JPY").amount).toBe(1234n); // exponent 0
    expect(fromDecimalString("1.5", "USD").amount).toBe(150n); // padded
    expect(fromDecimalString("0.001", "BHD").amount).toBe(1n); // three decimals
    expect(fromDecimalString("0.05", "USD").amount).toBe(5n);
  });

  it("is rounding-free: too many fractional digits throws", () => {
    expect(() => fromDecimalString("1.005", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString("1.0", "JPY")).toThrow(MoneyError); // JPY has none
  });

  it("rejects signs, separators and junk (caller normalizes first)", () => {
    expect(() => fromDecimalString("-1.00", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString("1,234.00", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString("$1.00", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString("", "USD")).toThrow(MoneyError);
  });

  it("rejects non-canonical leading zeros and malformed decimals", () => {
    expect(() => fromDecimalString("007.50", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString("00", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString("01.00", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString(".", "USD")).toThrow(MoneyError);
    expect(() => fromDecimalString("1.", "USD")).toThrow(MoneyError); // trailing dot
    expect(() => fromDecimalString("   ", "USD")).toThrow(MoneyError); // whitespace only
  });

  it("trims surrounding whitespace", () => {
    expect(toDecimalString(fromDecimalString("  1.00  ", "USD"))).toBe("1.00");
  });

  it("renders a canonical decimal string", () => {
    expect(toDecimalString(money(123456n, "USD"))).toBe("1234.56");
    expect(toDecimalString(money(5n, "USD"))).toBe("0.05");
    expect(toDecimalString(money(0n, "USD"))).toBe("0.00");
    expect(toDecimalString(money(1234n, "JPY"))).toBe("1234");
    expect(toDecimalString(money(1n, "BHD"))).toBe("0.001");
  });

  it("round-trips canonical strings for every currency", () => {
    const cases: Array<[string, Parameters<typeof fromDecimalString>[1]]> = [
      ["0.00", "USD"],
      ["1234.56", "MXN"],
      ["999999999999.99", "COP"],
      ["0", "JPY"],
      ["42", "JPY"],
      ["0.001", "BHD"],
      ["7.123", "BHD"],
    ];
    for (const [text, currency] of cases) {
      expect(toDecimalString(fromDecimalString(text, currency))).toBe(text);
    }
  });

  it("stays exact well beyond Number.MAX_SAFE_INTEGER", () => {
    const big = "92233720368547758.07"; // ~ 2^63 minor units
    expect(toDecimalString(fromDecimalString(big, "USD"))).toBe(big);
  });
});

describe("arithmetic", () => {
  it("adds same-currency amounts", () => {
    expect(addMoney(money(1001n, "USD"), money(99n, "USD")).amount).toBe(1100n);
  });

  it("avoids float drift (0.1 + 0.2 === 0.3)", () => {
    const sum = addMoney(fromDecimalString("0.1", "USD"), fromDecimalString("0.2", "USD"));
    expect(toDecimalString(sum)).toBe("0.30");
  });

  it("subtracts and throws on underflow", () => {
    expect(subtractMoney(money(500n, "USD"), money(200n, "USD")).amount).toBe(300n);
    expect(() => subtractMoney(money(200n, "USD"), money(500n, "USD"))).toThrow(MoneyError);
  });

  it("compares three-way", () => {
    expect(compareMoney(money(1n, "USD"), money(2n, "USD"))).toBe(-1);
    expect(compareMoney(money(2n, "USD"), money(2n, "USD"))).toBe(0);
    expect(compareMoney(money(3n, "USD"), money(2n, "USD"))).toBe(1);
  });

  it("throws on any mixed-currency operation (no implicit FX)", () => {
    expect(() => addMoney(money(1n, "USD"), money(1n, "MXN"))).toThrow(MoneyError);
    expect(() => subtractMoney(money(1n, "USD"), money(1n, "MXN"))).toThrow(MoneyError);
    expect(() => compareMoney(money(1n, "USD"), money(1n, "MXN"))).toThrow(MoneyError);
  });
});

describe("serialization boundary", () => {
  it("serializes to a DTO the Zod schema accepts", () => {
    const dto = toMoneyDTO(money(123456n, "USD"));
    expect(dto).toEqual({ amount: "123456", currency: "USD", minorUnitExponent: 2 });
    expect(MoneySchema.safeParse(dto).success).toBe(true);
  });

  it("rejects a DTO whose exponent disagrees with its currency", () => {
    const bad = { amount: "100", currency: "USD", minorUnitExponent: 3 };
    expect(MoneySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects negative or non-digit amounts at the boundary", () => {
    expect(
      MoneySchema.safeParse({ amount: "-1", currency: "USD", minorUnitExponent: 2 }).success,
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ amount: "1.5", currency: "USD", minorUnitExponent: 2 }).success,
    ).toBe(false);
  });

  it("pins the canonical amount form: no leading zeros, bounded length", () => {
    const base = { currency: "USD", minorUnitExponent: 2 } as const;
    expect(MoneySchema.safeParse({ ...base, amount: "0" }).success).toBe(true);
    expect(MoneySchema.safeParse({ ...base, amount: "007" }).success).toBe(false);
    expect(MoneySchema.safeParse({ ...base, amount: "01" }).success).toBe(false);
    expect(MoneySchema.safeParse({ ...base, amount: "9".repeat(30) }).success).toBe(true);
    expect(MoneySchema.safeParse({ ...base, amount: "9".repeat(31) }).success).toBe(false);
  });
});
