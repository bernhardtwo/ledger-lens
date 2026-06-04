import { describe, expect, it } from "vitest";
import { money, toMoneyDTO } from "./money.js";
import {
  type Transaction,
  TransactionDraftSchema,
  TransactionListItemSchema,
  TransactionSchema,
  parseTransaction,
  toTransactionDTO,
  toTransactionListItemDTO,
} from "./transaction.js";

const VALID_DTO = {
  id: "00000000-0000-4000-8000-000000000000",
  accountId: "11111111-1111-4111-8111-111111111111",
  statementId: "22222222-2222-4222-8222-222222222222",
  transactionDate: "2026-05-01",
  postedDate: "2026-05-03",
  description: "COFFEE BAR #12",
  direction: "debit",
  amount: { amount: "500", currency: "USD", minorUnitExponent: 2 },
  fingerprint: "sha256:deadbeef",
  rawRow: { Date: "05/01/2026", Amount: "-5.00", Memo: "COFFEE BAR #12" },
} as const;

describe("Transaction parsing & boundary mapping", () => {
  it("parses a valid DTO into a domain entity with a Money amount", () => {
    const tx = parseTransaction(VALID_DTO);
    expect(tx.amount).toEqual(money(500n, "USD")); // bigint magnitude, not a string
    expect(tx.direction).toBe("debit");
    expect(tx.transactionDate).toBe("2026-05-01");
    expect(tx.postedDate).toBe("2026-05-03");
  });

  it("round-trips DTO -> domain -> DTO exactly", () => {
    expect(toTransactionDTO(parseTransaction(VALID_DTO))).toEqual(VALID_DTO);
  });

  it("accepts a null postedDate (canonical date is transactionDate)", () => {
    const tx = parseTransaction({ ...VALID_DTO, postedDate: null });
    expect(tx.postedDate).toBeNull();
  });

  it("treats amount as a non-negative magnitude with direction carrying the sign", () => {
    // No signed amounts anywhere: the DTO amount is "500", direction says "out".
    expect(VALID_DTO.amount.amount).toBe("500");
    expect(TransactionSchema.safeParse({ ...VALID_DTO, direction: "sideways" }).success).toBe(
      false,
    );
  });
});

describe("Transaction adversarial inputs", () => {
  it("rejects a negative or signed amount at the boundary", () => {
    const negative = { ...VALID_DTO, amount: { ...VALID_DTO.amount, amount: "-500" } };
    expect(TransactionSchema.safeParse(negative).success).toBe(false);
  });

  it("rejects a malformed transactionDate and a datetime in a date field", () => {
    expect(
      TransactionSchema.safeParse({ ...VALID_DTO, transactionDate: "2026-13-40" }).success,
    ).toBe(false);
    expect(
      TransactionSchema.safeParse({ ...VALID_DTO, transactionDate: "2026-05-01T00:00:00Z" })
        .success,
    ).toBe(false);
  });

  it("requires a non-empty description and fingerprint", () => {
    expect(TransactionSchema.safeParse({ ...VALID_DTO, description: "" }).success).toBe(false);
    expect(TransactionSchema.safeParse({ ...VALID_DTO, fingerprint: "" }).success).toBe(false);
  });

  it("rejects non-string rawRow values (cells are raw text)", () => {
    expect(TransactionSchema.safeParse({ ...VALID_DTO, rawRow: { Amount: -5 } }).success).toBe(
      false,
    );
  });

  it("rejects a missing canonical transactionDate", () => {
    const { transactionDate: _omit, ...withoutDate } = VALID_DTO;
    expect(TransactionSchema.safeParse(withoutDate).success).toBe(false);
  });
});

describe("Transaction projections", () => {
  const tx: Transaction = parseTransaction(VALID_DTO);

  it("excludes rawRow from the list projection", () => {
    const item = toTransactionListItemDTO(tx);
    expect("rawRow" in item).toBe(false);
    expect(item.id).toBe(tx.id);
    expect(item.amount).toEqual(toMoneyDTO(tx.amount));
    expect(TransactionListItemSchema.safeParse(item).success).toBe(true);
  });

  it("list projection schema strips an incoming rawRow rather than carrying it", () => {
    const parsed = TransactionListItemSchema.parse(VALID_DTO);
    expect("rawRow" in parsed).toBe(false);
  });

  it("draft schema omits server-assigned id and statementId", () => {
    const { id: _id, statementId: _statementId, ...draft } = VALID_DTO;
    expect(TransactionDraftSchema.safeParse(draft).success).toBe(true);
    // a full row still parses (extra server fields are stripped, not rejected)
    expect(TransactionDraftSchema.safeParse(VALID_DTO).success).toBe(true);
    const parsedDraft = TransactionDraftSchema.parse(VALID_DTO);
    expect("id" in parsedDraft).toBe(false);
    expect("statementId" in parsedDraft).toBe(false);
  });
});
