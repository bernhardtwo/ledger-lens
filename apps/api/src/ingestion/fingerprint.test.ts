import { isoDate, money } from "@ledger-lens/shared";
import { describe, expect, it } from "vitest";
import { fingerprintAccepted, fingerprintRow } from "./fingerprint.js";
import type { NormalizedRow } from "./types.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

function row(overrides: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    transactionDate: isoDate("2026-05-01"),
    postedDate: null,
    description: "COFFEE BAR #12",
    direction: "debit",
    amount: money(500n, "USD"),
    rawRow: {},
    ...overrides,
  };
}

describe("fingerprintRow", () => {
  it("is deterministic and a 64-char sha256 hex string", () => {
    const first = fingerprintRow(ACCOUNT, row(), 0);
    expect(first).toBe(fingerprintRow(ACCOUNT, row(), 0));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the occurrence ordinal", () => {
    expect(fingerprintRow(ACCOUNT, row(), 0)).not.toBe(fingerprintRow(ACCOUNT, row(), 1));
  });

  it("ignores casing/whitespace in the description (shared normalizer, not reimplemented)", () => {
    const canonical = fingerprintRow(ACCOUNT, row({ description: "COFFEE BAR #12" }), 0);
    const messy = fingerprintRow(ACCOUNT, row({ description: "  coffee   bar #12 " }), 0);
    expect(messy).toBe(canonical);
  });
});

describe("fingerprintAccepted", () => {
  it("pairs each row with its fingerprint, in order", () => {
    const rows = [row(), row({ amount: money(600n, "USD") })];
    const paired = fingerprintAccepted(ACCOUNT, rows);
    expect(paired.map((entry) => entry.row)).toEqual(rows);
    for (const { fingerprint } of paired) {
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("gives two legitimately-identical rows distinct fingerprints via ordinals", () => {
    const [first, second] = fingerprintAccepted(ACCOUNT, [row(), row()]);
    expect(first?.fingerprint).toBeDefined();
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
  });

  it("gives distinct-content rows distinct fingerprints", () => {
    const [first, second] = fingerprintAccepted(ACCOUNT, [
      row(),
      row({ amount: money(600n, "USD") }),
    ]);
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
  });

  it("is order-stable across re-runs (fingerprint-level idempotency)", () => {
    const rows = [
      row(),
      row({ description: "ACME PAYROLL", direction: "credit", amount: money(120000n, "USD") }),
      row(),
    ];
    const fingerprints = (entries: ReturnType<typeof fingerprintAccepted>) =>
      entries.map((entry) => entry.fingerprint);
    expect(fingerprints(fingerprintAccepted(ACCOUNT, rows))).toEqual(
      fingerprints(fingerprintAccepted(ACCOUNT, rows)),
    );
  });
});
