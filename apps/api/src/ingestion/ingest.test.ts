import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { money } from "@ledger-lens/shared";
import { describe, expect, it } from "vitest";
import { IngestionError } from "./errors.js";
import { ingestCsv } from "./ingest.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
}

describe("ingestCsv — golden bank-a (signed amount, USD)", () => {
  const result = ingestCsv({ content: fixture("bank-a.csv"), accountId: ACCOUNT });

  it("matches the golden normalized output", () => {
    expect(result.profileId).toBe("bank-a@v1");
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(2);

    const [coffee, payroll] = result.accepted;
    expect(coffee).toMatchObject({
      transactionDate: "2026-05-01",
      postedDate: null,
      description: "COFFEE BAR #12",
      direction: "debit",
    });
    expect(coffee?.amount).toEqual(money(500n, "USD"));
    expect(payroll).toMatchObject({
      transactionDate: "2026-05-02",
      postedDate: null,
      description: "ACME PAYROLL",
      direction: "credit",
    });
    expect(payroll?.amount).toEqual(money(120000n, "USD"));
  });

  it("attaches a sha256 fingerprint and the account to each accepted row", () => {
    for (const draft of result.accepted) {
      expect(draft.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(draft.accountId).toBe(ACCOUNT);
    }
  });
});

describe("ingestCsv — golden banco-b (debit/credit columns, EUR, comma decimals)", () => {
  const result = ingestCsv({ content: fixture("banco-b.csv"), accountId: ACCOUNT });

  it("matches the golden normalized output, including the posting date", () => {
    expect(result.profileId).toBe("banco-b@v1");
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(2);

    const [cargo, abono] = result.accepted;
    expect(cargo).toMatchObject({
      transactionDate: "2026-05-01",
      postedDate: "2026-05-03",
      description: "PAGO TARJETA",
      direction: "debit",
    });
    expect(cargo?.amount).toEqual(money(123450n, "EUR"));
    expect(abono).toMatchObject({
      transactionDate: "2026-05-02",
      postedDate: "2026-05-02",
      description: "DEPOSITO NÓMINA",
      direction: "credit",
    });
    expect(abono?.amount).toEqual(money(200000n, "EUR"));
  });
});

describe("ingestCsv — adversarial inputs", () => {
  it("collects bad rows non-fatally and accepts the good majority", () => {
    const result = ingestCsv({ content: fixture("bank-a-bad-rows.csv"), accountId: ACCOUNT });
    expect(result.accepted).toHaveLength(5);
    expect(result.rejected).toHaveLength(4);
    const reasons = result.rejected.map((rejected) => rejected.reason);
    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("invalid date"),
        expect.stringContaining("unparseable amount"),
        expect.stringContaining("non-positive amount"),
        expect.stringContaining("description"),
      ]),
    );
  });

  it("rejects a column-count mismatch per-row, not fatally", () => {
    const result = ingestCsv({
      content: fixture("bank-a-column-mismatch.csv"),
      accountId: ACCOUNT,
    });
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([{ row: 2, reason: "column count mismatch" }]);
  });

  it("fails fast with the detected signature on unknown headers", () => {
    try {
      ingestCsv({ content: fixture("unknown-headers.csv"), accountId: ACCOUNT });
      expect.unreachable("unknown headers should abort the ingest");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect((error as IngestionError).kind).toBe("unknown-profile");
      expect((error as IngestionError).signature).toBe("bar|baz|foo");
    }
  });

  it("aborts the whole file when more than half the rows are rejected", () => {
    try {
      ingestCsv({ content: fixture("garbage.csv"), accountId: ACCOUNT });
      expect.unreachable("a mostly-garbage file should abort");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect((error as IngestionError).kind).toBe("too-many-rejected");
    }
  });

  it("rejects non-UTF-8 bytes", () => {
    // "Date" followed by 0xFF, which is never a valid UTF-8 byte.
    const bytes = new Uint8Array([0x44, 0x61, 0x74, 0x65, 0xff]);
    try {
      ingestCsv({ content: bytes, accountId: ACCOUNT });
      expect.unreachable("invalid UTF-8 should abort");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect((error as IngestionError).kind).toBe("not-utf8");
    }
  });

  it("strips a UTF-8 BOM so the header signature still matches", () => {
    const bom = String.fromCharCode(0xfeff);
    const result = ingestCsv({ content: `${bom}${fixture("bank-a.csv")}`, accountId: ACCOUNT });
    expect(result.profileId).toBe("bank-a@v1");
    expect(result.accepted).toHaveLength(2);
  });

  it("tolerates a stray quote in a field instead of throwing a whole-table error", () => {
    // relax_quotes: a lone quote mid-field is kept literal rather than aborting the
    // entire parse — so the row is ingested, not turned into a raw library throw.
    const result = ingestCsv({
      content: fixture("bank-a-stray-quote.csv"),
      accountId: ACCOUNT,
    });
    expect(result.profileId).toBe("bank-a@v1");
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0]?.description).toBe('ACME "BEST" CAFE');
  });
});

describe("ingestCsv — empty vs header-only", () => {
  it("rejects a truly empty file as empty-file (not unknown-profile)", () => {
    try {
      ingestCsv({ content: "", accountId: ACCOUNT });
      expect.unreachable("an empty file should abort");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect((error as IngestionError).kind).toBe("empty-file");
    }
  });

  it("treats a header-only file as a valid, empty statement", () => {
    const result = ingestCsv({ content: "Date,Description,Amount\n", accountId: ACCOUNT });
    expect(result.profileId).toBe("bank-a@v1");
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("rejects a zero amount in a debit/credit column as non-positive", () => {
    const csv =
      "Fecha,Fecha Valor,Concepto,Cargo,Abono\n" +
      '01/05/2026,03/05/2026,GOOD ONE,"10,00",\n' +
      '02/05/2026,02/05/2026,ZERO CARGO,"0,00",\n';
    const result = ingestCsv({ content: csv, accountId: ACCOUNT });
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([{ row: 2, reason: "non-positive amount" }]);
  });
});

describe("ingestCsv — idempotency & duplicates", () => {
  it("re-importing the same statement yields identical fingerprints", () => {
    const first = ingestCsv({ content: fixture("bank-a.csv"), accountId: ACCOUNT });
    const second = ingestCsv({ content: fixture("bank-a.csv"), accountId: ACCOUNT });
    expect(first.accepted.map((draft) => draft.fingerprint)).toEqual(
      second.accepted.map((draft) => draft.fingerprint),
    );
  });

  it("two legitimately-identical rows both survive with distinct fingerprints", () => {
    const result = ingestCsv({ content: fixture("bank-a-duplicates.csv"), accountId: ACCOUNT });
    expect(result.accepted).toHaveLength(2);
    const [first, second] = result.accepted;
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
  });

  it("a different account changes the fingerprint for identical content", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const mine = ingestCsv({ content: fixture("bank-a.csv"), accountId: ACCOUNT });
    const theirs = ingestCsv({ content: fixture("bank-a.csv"), accountId: other });
    expect(mine.accepted[0]?.fingerprint).not.toBe(theirs.accepted[0]?.fingerprint);
  });
});
