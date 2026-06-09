import { describe, expect, it } from "vitest";
import {
  answerContainsAmount,
  canonicalAmount,
  extractMoneyTokens,
  extractNumericTokens,
  renderDecimal,
} from "./money-match.js";

describe("renderDecimal", () => {
  it("renders a MoneyDTO as its canonical decimal", () => {
    expect(renderDecimal({ amount: "250402", currency: "USD", minorUnitExponent: 2 })).toBe(
      "2504.02",
    );
    expect(renderDecimal({ amount: "999", currency: "EUR", minorUnitExponent: 2 })).toBe("9.99");
    expect(renderDecimal({ amount: "500000", currency: "USD", minorUnitExponent: 2 })).toBe(
      "5000.00",
    );
  });
});

describe("canonicalAmount", () => {
  it("strips symbols, separators and all-zero fractions", () => {
    expect(canonicalAmount("$2,000.00")).toBe("2000");
    expect(canonicalAmount("2000")).toBe("2000");
    expect(canonicalAmount("2,000.0")).toBe("2000");
    expect(canonicalAmount("€50.00")).toBe("50");
    expect(canonicalAmount("007.50")).toBe("7.5");
  });

  it("keeps a non-zero fraction", () => {
    expect(canonicalAmount("2495.98")).toBe("2495.98");
    expect(canonicalAmount("$1,234.56")).toBe("1234.56");
  });

  it("maps an empty/zero token to 0", () => {
    expect(canonicalAmount("$")).toBe("0");
    expect(canonicalAmount("0.00")).toBe("0");
  });
});

describe("extractNumericTokens", () => {
  it("captures whole numeric runs, not fragments", () => {
    expect(extractNumericTokens("net $2,504.02 over 12504.02 days")).toEqual([
      "2,504.02",
      "12504.02",
    ]);
  });
});

describe("extractMoneyTokens", () => {
  it("keeps currency-prefixed and decimal tokens, drops bare integers", () => {
    expect(extractMoneyTokens("you had 12 transactions totaling $2,495.98 and €50.00")).toEqual([
      "2,495.98",
      "50.00",
    ]);
  });

  it("treats a bare decimal as money (a fabricated average)", () => {
    expect(extractMoneyTokens("an average of 80.51 per day")).toEqual(["80.51"]);
  });

  it("ignores counts, years and day numbers", () => {
    expect(extractMoneyTokens("31 days in 2026 across 8 transactions")).toEqual([]);
  });

  it("ignores a percentage (a ratio, not money)", () => {
    expect(extractMoneyTokens("that was about 5.5% of the $50.00 total")).toEqual(["50.00"]);
  });
});

describe("answerContainsAmount", () => {
  it("matches with separators and a dropped .00", () => {
    expect(answerContainsAmount("Your net was +$2,504.02 this month.", "2504.02")).toBe(true);
    expect(answerContainsAmount("You spent 2000 dollars on rent.", "2000.00")).toBe(true);
    expect(answerContainsAmount("That came to $35.", "35.00")).toBe(true);
  });

  it("is boundary-safe (no superset or extra-digit matches)", () => {
    expect(answerContainsAmount("It was 12504.02 total.", "2504.02")).toBe(false);
    expect(answerContainsAmount("It was 2504.029 total.", "2504.02")).toBe(false);
  });

  it("returns false when the figure is absent", () => {
    expect(answerContainsAmount("I am not able to answer that.", "2504.02")).toBe(false);
  });
});
