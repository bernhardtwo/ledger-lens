/**
 * Statement domain type (see spec 0001).
 *
 * A `Statement` records one ingestion of one CSV file into one account. Unlike
 * `Account`, it carries a true instant — `ingestedAt`, the moment the file was
 * processed — so the domain and boundary shapes differ: the in-memory `Statement`
 * holds a `Date`, while the JSON-safe `StatementDTO` serializes it to an ISO-8601
 * datetime string (the same domain/DTO split `Money` uses for `bigint`). This is
 * an instant, not a calendar date, so `Date` is the right type — contrast
 * `Transaction.transactionDate`, which is an `IsoDate` (see `iso-date.ts`).
 */
import { z } from "zod";

/** JSON-safe boundary shape for a `Statement` (API in/out). */
export const StatementSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  sourceFilename: z.string().min(1),
  profileId: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  // An instant: ISO-8601 with offset/Z at the boundary, a `Date` in the domain.
  // Boundary decision: `ingestedAt` is server-generated, so we pin its shape to
  // exactly what we emit — `Date.toISOString()`: UTC `Z` (offset: false rejects
  // a non-UTC offset) with millisecond precision (precision: 3 rejects sub-ms).
  // This keeps the wire form canonical and round-trip-stable, never a client's
  // arbitrary-precision or local-offset timestamp.
  ingestedAt: z.string().datetime({ offset: false, precision: 3 }),
});

/** The serialized form of a `Statement` (see `StatementSchema`). */
export type StatementDTO = z.infer<typeof StatementSchema>;

/** A statement as held in memory: `ingestedAt` is a real `Date` instant. */
export interface Statement {
  readonly id: string;
  readonly accountId: string;
  readonly sourceFilename: string;
  readonly profileId: string;
  readonly rowCount: number;
  readonly ingestedAt: Date;
}

/** Serialize a `Statement` to its JSON-safe DTO. */
export function toStatementDTO(statement: Statement): StatementDTO {
  return {
    id: statement.id,
    accountId: statement.accountId,
    sourceFilename: statement.sourceFilename,
    profileId: statement.profileId,
    rowCount: statement.rowCount,
    ingestedAt: statement.ingestedAt.toISOString(),
  };
}

/** Validate and deserialize an unknown input into a `Statement` at a boundary. */
export function parseStatement(input: unknown): Statement {
  const dto = StatementSchema.parse(input);
  return {
    id: dto.id,
    accountId: dto.accountId,
    sourceFilename: dto.sourceFilename,
    profileId: dto.profileId,
    rowCount: dto.rowCount,
    ingestedAt: new Date(dto.ingestedAt),
  };
}
