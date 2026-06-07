import { describe, expect, it } from "vitest";
import { parseDate } from "./date.js";

describe("parseDate", () => {
  it("parses each supported format to canonical ISO", () => {
    expect<string>(parseDate("05/01/2026", "MM/DD/YYYY")).toBe("2026-05-01");
    expect<string>(parseDate("01/05/2026", "DD/MM/YYYY")).toBe("2026-05-01");
    expect<string>(parseDate("2026-05-01", "YYYY-MM-DD")).toBe("2026-05-01");
  });

  it("trims surrounding whitespace", () => {
    expect<string>(parseDate("  05/01/2026 ", "MM/DD/YYYY")).toBe("2026-05-01");
  });

  it("rejects an impossible calendar date", () => {
    expect(() => parseDate("13/45/2026", "MM/DD/YYYY")).toThrow(/invalid date/);
  });

  it("rejects a structurally wrong string", () => {
    expect(() => parseDate("2026/05/01", "MM/DD/YYYY")).toThrow(/invalid date/);
    expect(() => parseDate("xx/xx/xxxx", "MM/DD/YYYY")).toThrow(/invalid date/);
  });
});
