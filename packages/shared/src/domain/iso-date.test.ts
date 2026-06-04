import { describe, expect, it } from "vitest";
import { IsoDateSchema, isoDate } from "./iso-date.js";

describe("IsoDate", () => {
  it("accepts a well-formed calendar date", () => {
    expect(isoDate("2026-01-15")).toBe("2026-01-15");
    expect(IsoDateSchema.safeParse("2024-02-29").success).toBe(true); // leap day
  });

  it("rejects datetimes, partials and impossible dates", () => {
    for (const bad of [
      "2026-01-15T00:00:00Z", // an instant, not a calendar date
      "2026-13-01", // month out of range
      "2026-00-10", // month out of range
      "2026-02-30", // day out of range
      "2026-1-5", // unpadded
      "15/01/2026", // wrong format
      "2026-01", // missing day
      "",
    ]) {
      expect(IsoDateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("throws via the constructor on malformed input", () => {
    expect(() => isoDate("not-a-date")).toThrow();
  });
});
