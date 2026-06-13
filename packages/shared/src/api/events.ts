/**
 * The `AgentEvent` wire contract for the streaming Q&A endpoint (ADR-0010). A Zod
 * discriminated union so the server (SSE emitter) and the web client (reducer)
 * validate against the **identical** symbol. Turn-level granularity:
 *
 * - `tool_call`   — the agent invoked a tool (domain name + input).
 * - `tool_result` — that tool returned; **`ok` only, never tool output or any
 *   figure** (numbers reach the client solely via the final `answer`, ADR-0004).
 * - `answer`      — the final natural-language answer text.
 * - `done`        — terminal success; `stopReason` is derived server-side from the
 *   SDK result subtype (`"step_limit"` for the turn/budget caps, else `"ok"`),
 *   never from a client-side cap or message pattern-matching.
 * - `error`       — a terminal agent fault (the SSE analog of `/ask`'s 502).
 *
 * `totalCostUsd` is deliberately absent — it is server-log-only (ADR-0008 §6) and
 * dropped before the wire.
 */
import { z } from "zod";

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_call"),
    tool: z.string(),
    input: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool: z.string(),
    ok: z.boolean(),
  }),
  z.object({
    type: z.literal("answer"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    stopReason: z.enum(["ok", "step_limit"]),
    meta: z.object({
      model: z.string(),
      turns: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    type: z.literal("error"),
    code: z.literal("agent_error"),
    message: z.string(),
  }),
]);

/** One streamed agent event (see `AgentEventSchema`). */
export type AgentEvent = z.infer<typeof AgentEventSchema>;
