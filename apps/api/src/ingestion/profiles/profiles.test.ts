import { describe, expect, it } from "vitest";
import { IngestionError } from "../errors.js";
import {
  type MappingProfile,
  PROFILES,
  buildProfileIndex,
  canonicalSignature,
  resolveProfile,
} from "./index.js";

describe("canonicalSignature", () => {
  it("is order-insensitive, trimmed and lower-cased", () => {
    expect(canonicalSignature(["Date", "Description", "Amount"])).toBe(
      canonicalSignature([" amount ", "DATE", "description"]),
    );
  });
});

describe("resolveProfile", () => {
  it("resolves a known header set regardless of column order", () => {
    expect(resolveProfile(["Amount", "Date", "Description"]).id).toBe("bank-a@v1");
    expect(resolveProfile(["Abono", "Cargo", "Concepto", "Fecha", "Fecha Valor"]).id).toBe(
      "banco-b@v1",
    );
  });

  it("fails fast with the detected signature when nothing matches", () => {
    try {
      resolveProfile(["foo", "bar", "baz"]);
      expect.unreachable("resolveProfile should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      const ingestionError = error as IngestionError;
      expect(ingestionError.kind).toBe("unknown-profile");
      expect(ingestionError.signature).toBe("bar|baz|foo");
    }
  });
});

describe("buildProfileIndex", () => {
  it("indexes every registered profile", () => {
    expect(buildProfileIndex(PROFILES).size).toBe(PROFILES.length);
  });

  it("throws on a header-signature collision", () => {
    const base = firstProfile();
    const a: MappingProfile = { ...base, id: "dup-a@v1" };
    const b: MappingProfile = { ...base, id: "dup-b@v1" };
    expect(() => buildProfileIndex([a, b])).toThrow(/collision/);
  });
});

function firstProfile(): MappingProfile {
  const profile = PROFILES[0];
  if (profile === undefined) {
    throw new Error("expected at least one registered profile");
  }
  return profile;
}
