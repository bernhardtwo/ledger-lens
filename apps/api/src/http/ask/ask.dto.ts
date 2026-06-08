import { z } from "zod";

/** Request body of `POST /accounts/:accountId/ask`. */
export const AskRequestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
});

export type AskRequest = z.infer<typeof AskRequestSchema>;

/** One tool the agent invoked — domain (prefix-stripped) name + its input. */
export const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.record(z.unknown()),
});

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
