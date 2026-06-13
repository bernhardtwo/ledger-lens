/**
 * Response envelope for `POST /accounts/:accountId/ask`, lifted out of `apps/api`
 * so the NestJS response-validation pipe and the web client import the **identical**
 * Zod symbol (single source of truth; see spec 0006). The request body
 * (`AskRequestSchema`) stays in the API — it is a request-side validator, not a
 * shared contract.
 */
import { z } from "zod";

/** One tool the agent invoked — domain (prefix-stripped) name + its input. */
export const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * Response of `POST /accounts/:accountId/ask`. `answer` is the agent's phrasing;
 * `toolCalls` is the "show your work" trail. `meta` carries the model and turn
 * count — cost/usage are logged server-side, never returned.
 */
export const AskResponseSchema = z.object({
  answer: z.string(),
  toolCalls: z.array(ToolCallSchema),
  meta: z.object({
    model: z.string(),
    turns: z.number().int().nonnegative(),
  }),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;
