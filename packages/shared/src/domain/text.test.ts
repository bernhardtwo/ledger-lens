import { describe, expect, it } from "vitest";
import { normalizeDescription } from "./text.js";

describe("normalizeDescription", () => {
  it("collapses whitespace runs and trims edges to a single space", () => {
    expect(normalizeDescription("  COFFEE   BAR\t#12 \n")).toBe("COFFEE BAR #12");
  });

  it("upper-cases so casing never affects the dedupe key", () => {
    expect(normalizeDescription("Coffee Bar #12")).toBe("COFFEE BAR #12");
  });

  it("folds Unicode compatibility/accent forms via NFKC", () => {
    // Combining-accent "café" and precomposed "café" must canonicalize equally.
    const combining = "café bar"; // e + combining acute
    const precomposed = "café bar"; // é
    expect(normalizeDescription(combining)).toBe(normalizeDescription(precomposed));
    expect(normalizeDescription(combining)).toBe("CAFÉ BAR");
  });

  it("is idempotent: normalize(normalize(x)) === normalize(x)", () => {
    const samples = [
      "  COFFEE   BAR\t#12 \n",
      "Coffee Bar #12",
      "café  BAR  #12",
      "TRANSFER   to   savings",
      "ＦＵＬＬＷＩＤＴＨ  ＡＣＨ", // fullwidth letters fold under NFKC
      "PAYPAL *MERCHANT NAME", // non-breaking space
      "x",
      "",
    ];
    for (const s of samples) {
      const once = normalizeDescription(s);
      expect(normalizeDescription(once)).toBe(once);
    }
  });
});
