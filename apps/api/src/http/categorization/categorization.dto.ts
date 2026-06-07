import { z } from "zod";

/**
 * Response of `POST /accounts/:accountId/categorize`. `totalUncategorized` is how
 * many rows were `category IS NULL` at the start; the rest split that total into
 * a real category (`categorized`), the fallback (`uncategorized`), or a
 * transport-failed batch left for retry (`failed`).
 */
export const CategorizeResponseSchema = z.object({
  totalUncategorized: z.number().int().nonnegative(),
  categorized: z.number().int().nonnegative(),
  uncategorized: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export type CategorizeResponse = z.infer<typeof CategorizeResponseSchema>;
