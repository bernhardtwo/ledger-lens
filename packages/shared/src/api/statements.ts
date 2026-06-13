/**
 * Response envelope for `POST /accounts/:accountId/statements`, lifted out of
 * `apps/api` so the NestJS response-validation pipe and the web client import the
 * **identical** Zod symbol (single source of truth; see spec 0006). The path-param
 * validator (`AccountIdSchema`) stays in the API — it is a request-side concern.
 */
import { z } from "zod";

/**
 * `statementId` is nullable: an idempotent re-import (or a header-only file)
 * persists no statement. `inserted`/`skipped` come from the persistence layer;
 * `rejected` from ingestion.
 */
export const StatementIngestResponseSchema = z.object({
  statementId: z.string().uuid().nullable(),
  profileId: z.string(),
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  rejected: z.array(z.object({ row: z.number().int(), reason: z.string() })),
});
export type StatementIngestResponse = z.infer<typeof StatementIngestResponseSchema>;
