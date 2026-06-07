import { describe, expect, it } from "vitest";
import { parseSignedDecimal } from "./amount.js";
import type { NumberFormat } from "./profiles/index.js";

const US: NumberFormat = { decimalSeparator: ".", parenthesesNegative: true };
const EU: NumberFormat = { decimalSeparator: ",", parenthesesNegative: false };

describe("parseSignedDecimal", () => {
  it("parses a negative US amount with thousands grouping", () => {
    expect(parseSignedDecimal("-1,200.50", US)).toEqual({ magnitude: "1200.50", sign: -1 });
  });

  it("parses a positive US amount", () => {
    expect(parseSignedDecimal("1,200.00", US)).toEqual({ magnitude: "1200.00", sign: 1 });
  });

  it("treats parentheses as negative when enabled", () => {
    expect(parseSignedDecimal("(5.00)", US)).toEqual({ magnitude: "5.00", sign: -1 });
  });

  it("parses European comma decimals with dot grouping", () => {
    expect(parseSignedDecimal("1.234,50", EU)).toEqual({ magnitude: "1234.50", sign: 1 });
  });

  it("strips a leading currency symbol", () => {
    expect(parseSignedDecimal("$1,200.00", US)).toEqual({ magnitude: "1200.00", sign: 1 });
    expect(parseSignedDecimal("€2.000,00", EU)).toEqual({ magnitude: "2000.00", sign: 1 });
  });

  it("reports an exact zero with sign 0", () => {
    expect(parseSignedDecimal("0.00", US)).toEqual({ magnitude: "0.00", sign: 0 });
  });

  it("is lenient about grouping-separator placement (input comes from a declared profile)", () => {
    // Misplaced thousands separators are stripped, not validated. Documented as
    // intentional leniency: amount cells are trusted to come from the matched profile.
    expect(parseSignedDecimal("1,2,3,4.50", US)).toEqual({ magnitude: "1234.50", sign: 1 });
  });

  it("throws on an empty or unparseable cell", () => {
    expect(() => parseSignedDecimal("   ", US)).toThrow(/empty amount/);
    expect(() => parseSignedDecimal("abc", US)).toThrow(/unparseable amount/);
  });
});
