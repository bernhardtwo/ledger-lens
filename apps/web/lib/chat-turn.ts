/**
 * The pure reducer for one assistant turn (ADR-0010, spec 0006 decision 3):
 * `AgentEvent` → `TurnState`. The priority for unit tests. No I/O, no React.
 *
 * - `tool_call`   → append a tool-call row (status "running");
 * - `tool_result` → mark the matching running row done with its `ok` flag. Results
 *   echo `tool_use` order (Anthropic content-block contract; see the API mapper in
 *   `apps/api/src/agent/stream.ts`), and the wire carries no id — so when the same
 *   tool is called twice in a turn we bind to the FIRST still-running row of that
 *   name (FIFO). An out-of-order / duplicate result with no running row is ignored;
 * - `answer`      → set the answer text (rendered as-is — limitations/refusals are
 *   ordinary answers, never special-cased);
 * - `done`        → finalize with meta + stopReason (the UI shows a subtle note
 *   only when stopReason === "step_limit");
 * - `error`       → error state (the UI offers retry).
 */
import type { AgentEvent } from "./contracts";

export interface ToolRow {
  /** Stable creation-order id (rows are append-only, never reordered). */
  readonly id: number;
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly status: "running" | "ok" | "failed";
}

export interface TurnState {
  readonly tools: readonly ToolRow[];
  readonly answer: string | null;
  readonly meta: { readonly model: string; readonly turns: number } | null;
  readonly stopReason: "ok" | "step_limit" | null;
  readonly error: string | null;
  readonly done: boolean;
}

export const initialTurn: TurnState = {
  tools: [],
  answer: null,
  meta: null,
  stopReason: null,
  error: null,
  done: false,
};

export function turnReducer(state: TurnState, event: AgentEvent): TurnState {
  switch (event.type) {
    case "tool_call":
      return {
        ...state,
        tools: [
          ...state.tools,
          { id: state.tools.length, tool: event.tool, input: event.input, status: "running" },
        ],
      };
    case "tool_result": {
      const idx = firstRunningIndex(state.tools, event.tool);
      if (idx === -1) {
        return state; // out-of-order / duplicate result with no running row → ignore
      }
      const status: ToolRow["status"] = event.ok ? "ok" : "failed";
      return {
        ...state,
        tools: state.tools.map((row, i) => (i === idx ? { ...row, status } : row)),
      };
    }
    case "answer":
      return { ...state, answer: event.text };
    case "done":
      return { ...state, meta: event.meta, stopReason: event.stopReason, done: true };
    case "error":
      return { ...state, error: event.message, done: true };
    default:
      return state;
  }
}

/** The FIRST still-running row for a tool name, so repeated calls resolve FIFO. */
function firstRunningIndex(tools: readonly ToolRow[], tool: string): number {
  for (let i = 0; i < tools.length; i += 1) {
    const row = tools[i];
    if (row !== undefined && row.tool === tool && row.status === "running") {
      return i;
    }
  }
  return -1;
}

/** Fold a complete event sequence to its final `TurnState` (batch form, for tests). */
export function foldTurn(events: readonly AgentEvent[]): TurnState {
  let state = initialTurn;
  for (const event of events) {
    state = turnReducer(state, event);
  }
  return state;
}
