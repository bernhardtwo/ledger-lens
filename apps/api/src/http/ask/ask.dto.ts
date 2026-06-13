import { z } from "zod";

// `AskResponseSchema` + `ToolCallSchema` now live in `@ledger-lens/shared`
// (spec 0006) so the client validates the identical schema; re-exported here so
// existing imports (controller, service) keep resolving. `AskRequestSchema` stays
// below — it is a request-side validator, not a shared response contract.
export { AskResponseSchema, ToolCallSchema } from "@ledger-lens/shared";
export type { AskResponse } from "@ledger-lens/shared";

/** Request body of `POST /accounts/:accountId/ask`. */
export const AskRequestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
});

export type AskRequest = z.infer<typeof AskRequestSchema>;
