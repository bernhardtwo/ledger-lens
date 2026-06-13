import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { AgentEventSchema } from "@ledger-lens/shared";
import { describe, expect, it } from "vitest";
import {
  NO_ANSWER_MESSAGE,
  STEP_LIMIT_MESSAGE,
  extractAnswer,
  extractToolCalls,
  totalCostUsd,
} from "./query.js";
import { prefixed } from "./scope.js";
import { foldEvents, foldMessages, toAgentEvents } from "./stream.js";
import { AgentExecutionError } from "./types.js";

const MODEL = "claude-haiku-4-5";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

// Minimal SDK message fixtures — the mapper reads only the fields populated here.
function assistantToolUse(name: string, input: unknown, id = "t1", parent: string | null = null) {
  return {
    type: "assistant",
    parent_tool_use_id: parent,
    message: { content: [{ type: "tool_use", id, name, input }] },
  } as unknown as SDKMessage;
}
function userToolResult(toolUseId: string, isError = false, parent: string | null = null) {
  return {
    type: "user",
    parent_tool_use_id: parent,
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: isError }] },
  } as unknown as SDKMessage;
}
function successResult(result: string, turns: number, cost = 0.01) {
  return {
    type: "result",
    subtype: "success",
    result,
    num_turns: turns,
    total_cost_usd: cost,
  } as unknown as SDKMessage;
}
function errorResult(subtype: string, turns: number) {
  return {
    type: "result",
    subtype,
    num_turns: turns,
    total_cost_usd: 0.02,
  } as unknown as SDKMessage;
}

describe("toAgentEvents", () => {
  it("maps a full turn: tool_call -> tool_result(ok) -> answer -> done(ok)", () => {
    const events = toAgentEvents(
      [
        assistantToolUse(prefixed("summarize_account"), { accountId: ACCOUNT }, "tu1"),
        userToolResult("tu1"),
        successResult("Your net was +$10.00.", 2),
      ],
      MODEL,
    );
    expect(events).toEqual([
      { type: "tool_call", tool: "summarize_account", input: { accountId: ACCOUNT } },
      { type: "tool_result", tool: "summarize_account", ok: true },
      { type: "answer", text: "Your net was +$10.00." },
      { type: "done", stopReason: "ok", meta: { model: MODEL, turns: 2 } },
    ]);
    // Every emitted event is valid on the shared wire contract.
    for (const event of events) {
      expect(() => AgentEventSchema.parse(event)).not.toThrow();
    }
  });

  it("resolves a tool_result's tool by id and marks is_error -> ok:false", () => {
    const events = toAgentEvents(
      [
        assistantToolUse(prefixed("list_transactions"), { accountId: ACCOUNT }, "tu2"),
        userToolResult("tu2", true),
        successResult("done", 1),
      ],
      MODEL,
    );
    expect(events).toContainEqual({ type: "tool_result", tool: "list_transactions", ok: false });
  });

  it("excludes sub-agent tool_use (parent_tool_use_id set)", () => {
    const events = toAgentEvents(
      [
        assistantToolUse(prefixed("summarize_account"), { accountId: ACCOUNT }, "tu3", "parent-1"),
        successResult("x", 1),
      ],
      MODEL,
    );
    expect(events.filter((e) => e.type === "tool_call")).toEqual([]);
  });

  it("derives stopReason=step_limit from the cap subtypes, with the graceful message", () => {
    for (const subtype of ["error_max_turns", "error_max_budget_usd"]) {
      expect(toAgentEvents([errorResult(subtype, 8)], MODEL)).toEqual([
        { type: "answer", text: STEP_LIMIT_MESSAGE },
        { type: "done", stopReason: "step_limit", meta: { model: MODEL, turns: 8 } },
      ]);
    }
  });

  it("emits a single terminal error event on an execution error and on no result", () => {
    expect(toAgentEvents([errorResult("error_during_execution", 2)], MODEL)).toEqual([
      { type: "error", code: "agent_error", message: expect.any(String) },
    ]);
    expect(toAgentEvents([], MODEL)).toEqual([
      { type: "error", code: "agent_error", message: expect.any(String) },
    ]);
  });

  it("falls back to NO_ANSWER_MESSAGE when a success result carries no text", () => {
    expect(toAgentEvents([successResult("   ", 1)], MODEL)).toContainEqual({
      type: "answer",
      text: NO_ANSWER_MESSAGE,
    });
  });
});

describe("foldEvents", () => {
  it("re-throws a terminal error event as AgentExecutionError", () => {
    expect(() => foldEvents([{ type: "error", code: "agent_error", message: "x" }])).toThrow(
      AgentExecutionError,
    );
  });
});

// The byte-identity guarantee (ADR-0010): /ask is a fold over the SAME AgentEvent
// sequence askStream emits, and that fold must equal the pre-stream extract* helpers
// across the four terminal shapes. extract* / totalCostUsd remain the proven oracle
// this pins against (this is what keeps the eval + the 47 integration tests honest).
describe("ask = fold(askStream) parity across the four terminal shapes", () => {
  const shapes: { name: string; messages: SDKMessage[] }[] = [
    {
      name: "success with text + tool calls",
      messages: [
        assistantToolUse(prefixed("summarize_account"), { accountId: ACCOUNT }, "tu1"),
        userToolResult("tu1"),
        successResult("Your net was +$10.00.", 3),
      ],
    },
    { name: "empty-text success", messages: [successResult("   ", 1)] },
    { name: "graceful step-limit", messages: [errorResult("error_max_turns", 8)] },
  ];

  for (const { name, messages } of shapes) {
    it(`matches extract* for: ${name}`, () => {
      const folded = foldEvents(toAgentEvents(messages, MODEL));
      const oracle = extractAnswer(messages);
      expect(folded.answer).toBe(oracle.answer);
      expect(folded.turns).toBe(oracle.turns);
      expect(folded.toolCalls).toEqual(extractToolCalls(messages));
      expect(folded.model).toBe(MODEL);
    });
  }

  it("matches extract* for: error / no-result (both throw AgentExecutionError)", () => {
    for (const messages of [[errorResult("error_during_execution", 2)], [] as SDKMessage[]]) {
      expect(() => foldEvents(toAgentEvents(messages, MODEL))).toThrow(AgentExecutionError);
      expect(() => extractAnswer(messages)).toThrow(AgentExecutionError);
    }
  });

  // foldMessages is the EXACT composition production `ask()` calls; pin its full
  // QaAnswer (incl. costUsd, which the eval reads) to the extract* + totalCostUsd path.
  it("foldMessages reproduces the full QaAnswer (incl. costUsd) of the extract* path", () => {
    const shapesWithCost: SDKMessage[][] = [
      [
        assistantToolUse(prefixed("summarize_account"), { accountId: ACCOUNT }, "tu1"),
        userToolResult("tu1"),
        successResult("Your net was +$10.00.", 3, 0.0123),
      ],
      [errorResult("error_max_turns", 8)],
    ];
    for (const messages of shapesWithCost) {
      const oracle = extractAnswer(messages);
      expect(foldMessages(messages, MODEL)).toEqual({
        answer: oracle.answer,
        toolCalls: extractToolCalls(messages),
        model: MODEL,
        turns: oracle.turns,
        costUsd: totalCostUsd(messages),
      });
    }
  });
});
