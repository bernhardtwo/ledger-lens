import { z } from "zod";

/** Path param: the owning account id. */
export const AccountIdSchema = z.string().uuid();

/**
 * Response of `POST /accounts/:accountId/statements`. `statementId` is nullable:
 * an idempotent re-import (or a header-only file) persists no statement.
 * `inserted`/`skipped` come from the persistence layer; `rejected` from ingestion.
 */
export const StatementIngestResponseSchema = z.object({
  statementId: z.string().uuid().nullable(),
  profileId: z.string(),
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  rejected: z.array(z.object({ row: z.number().int(), reason: z.string() })),
});

export type StatementIngestResponse = z.infer<typeof StatementIngestResponseSchema>;
