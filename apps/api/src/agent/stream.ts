/**
 * Pure `SDKMessage` -> `AgentEvent` mapping for the streaming Q&A path (ADR-0010).
 * This is the SINGLE classifier shared by both transports, so JSON (`/ask`) and SSE
 * cannot drift:
 *  - `createEventMapper()` is the incremental form `askStream` drives per message;
 *  - `toAgentEvents()` is the batch form the `/ask` fold + the parity test use;
 *  - `foldMessages()` is the exact `messages -> QaAnswer` composition `ask()` calls.
 * No network / no I/O — offline-testable like the `extract*` helpers in `query.ts`
 * (which remain the parity oracle this is pinned against). `stopReason` is derived
 * from the SDK result subtype (server-side), never a client `turns === cap` or
 * message pattern-match; `totalCostUsd` is never placed on an event (dropped before
 * the wire, ADR-0008 §6) — it survives only on the folded `QaAnswer`.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@ledger-lens/shared";
import { NO_ANSWER_MESSAGE, STEP_LIMIT_MESSAGE, totalCostUsd } from "./query.js";
import { stripPrefix } from "./scope.js";
import { AgentExecutionError, type QaAnswer, type ToolCall } from "./types.js";

/** Safe, generic terminal fault message — mirrors the `/ask` 502 (ADR-0008 §7). */
const AGENT_ERROR_MESSAGE = "the agent could not complete the request";

function agentErrorEvent(): AgentEvent {
  return { type: "error", code: "agent_error", message: AGENT_ERROR_MESSAGE };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Incremental mapper over an in-order message stream. Feed each `SDKMessage` to
 * `push()` and call `end()` once after the loop to flush a terminal error if no
 * `result` arrived (parity with `extractAnswer` throwing on a missing result).
 * `fail()` turns a query()-loop fault into a terminal error event. It tracks
 * `tool_use` id -> domain name so a later `tool_result` can name its tool — the
 * wire still carries no tool output, only `ok`.
 */
export function createEventMapper(model: string) {
  const toolNamesById = new Map<string, string>();
  let terminal = false;

  function push(message: SDKMessage): AgentEvent[] {
    // Ignore anything after the terminal `result` — `extractAnswer` takes the FIRST
    // result, so this keeps the fold and the oracle aligned even if the SDK ever
    // emitted a trailing message.
    if (terminal) {
      return [];
    }
    // Main thread only (`parent_tool_use_id === null`) — sub-agent traffic is
    // excluded exactly as `extractToolCalls` does (and sub-agents are disabled).
    if (message.type === "assistant" && message.parent_tool_use_id === null) {
      const events: AgentEvent[] = [];
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const tool = stripPrefix(block.name);
          toolNamesById.set(block.id, tool);
          events.push({ type: "tool_call", tool, input: asRecord(block.input) });
        }
      }
      return events;
    }
    if (message.type === "user" && message.parent_tool_use_id === null) {
      const content = message.message.content;
      if (!Array.isArray(content)) {
        return [];
      }
      const events: AgentEvent[] = [];
      for (const block of content) {
        if (block.type === "tool_result") {
          const tool = toolNamesById.get(block.tool_use_id);
          // Unresolved id -> skip the decoration rather than emit a bogus name. This
          // also intentionally drops sub-agent tool results (their tool_use was
          // excluded from the map above), which is the determinism-safe choice.
          if (tool !== undefined) {
            events.push({ type: "tool_result", tool, ok: block.is_error !== true });
          }
        }
      }
      return events;
    }
    if (message.type === "result") {
      terminal = true;
      if (message.subtype === "success") {
        const text = message.result.trim() === "" ? NO_ANSWER_MESSAGE : message.result;
        return [
          { type: "answer", text },
          { type: "done", stopReason: "ok", meta: { model, turns: message.num_turns } },
        ];
      }
      if (message.subtype === "error_max_turns" || message.subtype === "error_max_budget_usd") {
        return [
          { type: "answer", text: STEP_LIMIT_MESSAGE },
          { type: "done", stopReason: "step_limit", meta: { model, turns: message.num_turns } },
        ];
      }
      // error_during_execution / error_max_structured_output_retries / anything else.
      return [agentErrorEvent()];
    }
    return [];
  }

  function end(): AgentEvent[] {
    if (terminal) {
      return [];
    }
    terminal = true;
    return [agentErrorEvent()];
  }

  function fail(): AgentEvent[] {
    terminal = true;
    return [agentErrorEvent()];
  }

  return { push, end, fail };
}

/** Batch form: the full, ordered event sequence for a completed message array. */
export function toAgentEvents(messages: readonly SDKMessage[], model: string): AgentEvent[] {
  const mapper = createEventMapper(model);
  const events: AgentEvent[] = [];
  for (const message of messages) {
    events.push(...mapper.push(message));
  }
  events.push(...mapper.end());
  return events;
}

/** The non-streamed answer shape folded out of an event sequence (no cost). */
export interface FoldedAnswer {
  readonly answer: string;
  readonly toolCalls: ToolCall[];
  readonly turns: number;
  readonly model: string;
}

/**
 * Fold an `AgentEvent` sequence back to the `/ask` answer shape. A terminal `error`
 * event is re-thrown as `AgentExecutionError`, so the `/ask` 502 path is
 * byte-identical to the pre-stream `extractAnswer` behaviour. `stopReason` is
 * SSE-only and intentionally dropped here (the JSON `meta` carries only
 * model + turns, as ratified); `tool_result` events are stream-only decoration.
 */
export function foldEvents(events: readonly AgentEvent[]): FoldedAnswer {
  const toolCalls: ToolCall[] = [];
  let answer: string | undefined;
  let turns: number | undefined;
  let model: string | undefined;
  for (const event of events) {
    switch (event.type) {
      case "tool_call":
        toolCalls.push({ tool: event.tool, input: event.input });
        break;
      case "answer":
        answer = event.text;
        break;
      case "done":
        turns = event.meta.turns;
        model = event.meta.model;
        break;
      case "error":
        throw new AgentExecutionError(event.message);
      default:
        break; // tool_result: stream-only, ignored by the fold.
    }
  }
  if (answer === undefined || turns === undefined || model === undefined) {
    throw new AgentExecutionError("the agent produced no terminal result");
  }
  return { answer, toolCalls, turns, model };
}

/**
 * The exact `messages -> QaAnswer` composition `AgentSdkQaAgent.ask()` uses: classify
 * via the shared fold, and read cost from the raw result (`totalCostUsd`) since the
 * wire events drop it. The single tested source for the non-stream answer — the
 * parity test pins it (incl. `costUsd`, which the eval reads) to the `extract*` path.
 */
export function foldMessages(messages: readonly SDKMessage[], model: string): QaAnswer {
  const folded = foldEvents(toAgentEvents(messages, model));
  return { ...folded, costUsd: totalCostUsd(messages) };
}
