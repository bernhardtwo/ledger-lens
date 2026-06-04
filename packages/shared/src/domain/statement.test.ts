import { describe, expect, it } from "vitest";
import { type Statement, StatementSchema, parseStatement, toStatementDTO } from "./statement.js";

const VALID_DTO = {
  id: "00000000-0000-4000-8000-000000000000",
  accountId: "11111111-1111-4111-8111-111111111111",
  sourceFilename: "bank-a-2026-05.csv",
  profileId: "bank-a@v1",
  rowCount: 42,
  ingestedAt: "2026-06-03T12:34:56.000Z",
} as const;

describe("Statement parsing", () => {
  it("deserializes the instant to a Date", () => {
    const statement = parseStatement(VALID_DTO);
    expect(statement.ingestedAt).toBeInstanceOf(Date);
    expect(statement.ingestedAt.toISOString()).toBe(VALID_DTO.ingestedAt);
  });

  it("round-trips domain -> DTO -> domain exactly", () => {
    const statement = parseStatement(VALID_DTO);
    expect(toStatementDTO(statement)).toEqual(VALID_DTO);
    expect(parseStatement(toStatementDTO(statement))).toEqual(statement);
  });

  it("rejects a non-ISO ingestedAt and a date-only string", () => {
    expect(StatementSchema.safeParse({ ...VALID_DTO, ingestedAt: "2026-06-03" }).success).toBe(
      false,
    );
    expect(StatementSchema.safeParse({ ...VALID_DTO, ingestedAt: "yesterday" }).success).toBe(
      false,
    );
  });

  it("rejects negative or fractional row counts and bad uuids", () => {
    expect(StatementSchema.safeParse({ ...VALID_DTO, rowCount: -1 }).success).toBe(false);
    expect(StatementSchema.safeParse({ ...VALID_DTO, rowCount: 1.5 }).success).toBe(false);
    expect(StatementSchema.safeParse({ ...VALID_DTO, accountId: "nope" }).success).toBe(false);
  });

  it("serializes a Date instant to an ISO string", () => {
    const statement: Statement = {
      id: VALID_DTO.id,
      accountId: VALID_DTO.accountId,
      sourceFilename: VALID_DTO.sourceFilename,
      profileId: VALID_DTO.profileId,
      rowCount: VALID_DTO.rowCount,
      ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(toStatementDTO(statement).ingestedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
