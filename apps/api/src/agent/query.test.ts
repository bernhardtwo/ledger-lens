import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import {
  type AgentConfig,
  NO_ANSWER_MESSAGE,
  STEP_LIMIT_MESSAGE,
  buildAskOptions,
  extractAnswer,
  extractToolCalls,
} from "./query.js";
import { prefixed } from "./scope.js";
import { AgentExecutionError } from "./types.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";

const CONFIG: AgentConfig = {
  model: "claude-haiku-4-5",
  maxTurns: 8,
  maxBudgetUsd: 0.15,
  databaseUrl: "postgresql://u:p@localhost:5432/db",
  mcpLaunch: { command: "/usr/bin/node", args: ["--import", "/abs/tsx.mjs", "/abs/main.ts"] },
  apiKey: "sk-test-key",
};

// Minimal SDK message fixtures — the helpers only read the fields asserted here.
function successResult(result: string, turns: number): SDKMessage {
  return { type: "result", subtype: "success", result, num_turns: turns } as unknown as SDKMessage;
}
function errorResult(subtype: string, turns: number): SDKMessage {
  return { type: "result", subtype, num_turns: turns, errors: ["x"] } as unknown as SDKMessage;
}
function assistantToolUse(
  name: string,
  input: unknown,
  parentToolUseId: string | null = null,
): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    message: { content: [{ type: "tool_use", id: "t", name, input }] },
  } as unknown as SDKMessage;
}
function assistantText(text: string): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text }] },
  } as unknown as SDKMessage;
}

describe("buildAskOptions", () => {
  const options = buildAskOptions(CONFIG, ACCOUNT);

  it("wires model + caps and locks down the tool surface", () => {
    expect(options.model).toBe("claude-haiku-4-5");
    expect(options.maxTurns).toBe(8);
    expect(options.maxBudgetUsd).toBe(0.15);
    expect(options.tools).toEqual([]); // no built-in Claude Code tools
    expect(options.strictMcpConfig).toBe(true);
    expect(options.permissionMode).toBe("default");
    expect(typeof options.canUseTool).toBe("function");
  });

  it("hides list_accounts and scopes the system prompt to the account", () => {
    expect(options.disallowedTools).toContain(prefixed("list_accounts"));
    expect(options.systemPrompt).toContain(ACCOUNT);
  });

  // The wiring between assertInScope and the SDK — a bug here (e.g. inverted
  // allow/deny) would pass every other test, so assert the guard's verdicts.
  it("canUseTool allows in-scope and denies foreign account / list_accounts", async () => {
    const guard = options.canUseTool;
    const decide = (tool: string, input: Record<string, unknown>) =>
      guard?.(tool, input, undefined as never);

    expect(await decide(prefixed("summarize_account"), { accountId: ACCOUNT })).toEqual({
      behavior: "allow",
    });
    expect((await decide(prefixed("summarize_account"), { accountId: OTHER }))?.behavior).toBe(
      "deny",
    );
    expect((await decide(prefixed("list_accounts"), { accountId: ACCOUNT }))?.behavior).toBe(
      "deny",
    );
  });

  it("gives DATABASE_URL only to the MCP child, the API key only to the agent", () => {
    const mcp = options.mcpServers?.ledgerlens as {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
    expect(mcp.command).toBe(CONFIG.mcpLaunch.command);
    expect(mcp.args).toEqual([...CONFIG.mcpLaunch.args]);
    expect(mcp.env?.DATABASE_URL).toBe(CONFIG.databaseUrl);
    // Least privilege: the MCP server never gets the API key...
    expect(mcp.env?.ANTHROPIC_API_KEY).toBeUndefined();
    // ...but the agent process does.
    expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBe(CONFIG.apiKey);
  });
});

describe("extractAnswer", () => {
  it("returns the result text + turn count on success", () => {
    expect(extractAnswer([successResult("Your net was $10.", 3)])).toEqual({
      answer: "Your net was $10.",
      turns: 3,
    });
  });

  it("maps the turn/budget caps to the graceful step-limit message", () => {
    expect(extractAnswer([errorResult("error_max_turns", 8)]).answer).toBe(STEP_LIMIT_MESSAGE);
    expect(extractAnswer([errorResult("error_max_budget_usd", 5)]).answer).toBe(STEP_LIMIT_MESSAGE);
  });

  it("falls back when a success result carries no text", () => {
    expect(extractAnswer([successResult("   ", 1)]).answer).toBe(NO_ANSWER_MESSAGE);
  });

  it("throws AgentExecutionError on an execution error or a missing result", () => {
    expect(() => extractAnswer([errorResult("error_during_execution", 2)])).toThrow(
      AgentExecutionError,
    );
    expect(() => extractAnswer([])).toThrow(AgentExecutionError);
  });
});

describe("extractToolCalls", () => {
  it("collects tool_use blocks in order, stripped of the mcp prefix", () => {
    const calls = extractToolCalls([
      assistantToolUse(prefixed("summarize_account"), { accountId: ACCOUNT }),
      assistantText("let me also list them"),
      assistantToolUse(prefixed("list_transactions"), { accountId: ACCOUNT, category: "dining" }),
      successResult("done", 3),
    ]);
    expect(calls).toEqual([
      { tool: "summarize_account", input: { accountId: ACCOUNT } },
      { tool: "list_transactions", input: { accountId: ACCOUNT, category: "dining" } },
    ]);
  });

  it("returns no calls when the agent only produced text", () => {
    expect(extractToolCalls([assistantText("hi"), successResult("hi", 1)])).toEqual([]);
  });

  it("excludes sub-agent tool calls (parent_tool_use_id set)", () => {
    const calls = extractToolCalls([
      assistantToolUse(prefixed("summarize_account"), { accountId: ACCOUNT }),
      assistantToolUse(prefixed("list_transactions"), { accountId: ACCOUNT }, "parent-123"),
      successResult("done", 2),
    ]);
    expect(calls).toEqual([{ tool: "summarize_account", input: { accountId: ACCOUNT } }]);
  });
});
