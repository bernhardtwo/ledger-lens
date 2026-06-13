/**
 * Response envelope for `POST /accounts/:accountId/categorize`, lifted out of
 * `apps/api` so the NestJS response-validation pipe and the web client import the
 * **identical** Zod symbol (single source of truth; see spec 0006).
 */
import { z } from "zod";

/**
 * `totalUncategorized` is how many rows were `category IS NULL` at the start; the
 * rest split that total into a real category (`categorized`), the fallback
 * (`uncategorized`), or a transport-failed batch left for retry (`failed`).
 */
export const CategorizeResponseSchema = z.object({
  totalUncategorized: z.number().int().nonnegative(),
  categorized: z.number().int().nonnegative(),
  uncategorized: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type CategorizeResponse = z.infer<typeof CategorizeResponseSchema>;
