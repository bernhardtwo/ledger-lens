/**
 * Pure helpers that shape the Claude Agent SDK boundary (see ADR-0008 §8). They
 * carry the adapter's logic so it is unit-testable offline; only the live
 * `query()` call in `agent-sdk-client.ts` is smoke-only. No network, no I/O here.
 */
import type { Options, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { McpLaunch } from "./mcp-launch.js";
import { buildSystemPrompt } from "./prompt.js";
import { LIST_ACCOUNTS, MCP_SERVER_NAME, prefixed, resolveToolCall, stripPrefix } from "./scope.js";
import { AgentExecutionError, type ToolCall } from "./types.js";

/** Graceful 200 message when the agent hits the turn/budget limit (ADR-0008 §7). */
export const STEP_LIMIT_MESSAGE =
  "I couldn't complete this within the step limit. Try narrowing the question — for example, to a specific month or a single category.";

/** Fallback when the agent finishes successfully but produced no answer text. */
export const NO_ANSWER_MESSAGE = "I wasn't able to produce an answer to that question.";

/** Everything `buildAskOptions` needs; the adapter fills it from env at call time. */
export interface AgentConfig {
  readonly model: string;
  readonly maxTurns: number;
  readonly maxBudgetUsd: number;
  /** Passed only to the MCP child (never to the agent process). */
  readonly databaseUrl: string;
  /** How to spawn the MCP server over stdio (command + absolute args). */
  readonly mcpLaunch: McpLaunch;
  /** Agent-process API key; spread into the agent env (never the MCP child's). */
  readonly apiKey: string;
}

/**
 * Build the `query()` options for one account-scoped question. The boundary is
 * locked down: no built-in Claude Code tools (`tools: []`), only our MCP server
 * (`strictMcpConfig`), `list_accounts` hidden (`disallowedTools`), and the
 * `canUseTool` guard denying any out-of-scope call. `DATABASE_URL` goes only to
 * the MCP child; `ANTHROPIC_API_KEY` only to the agent process.
 */
export function buildAskOptions(config: AgentConfig, accountId: string): Options {
  return {
    model: config.model,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    systemPrompt: buildSystemPrompt(accountId),
    // No built-in tools (Bash/Read/Write/…) AND no `agents`: with no Task tool the
    // model cannot spawn a sub-agent, so EVERY tool call passes through `canUseTool`
    // below — that is what makes the scope guard total. Do not add built-ins/agents
    // without revisiting scoping (and `extractToolCalls`' main-thread filter).
    tools: [],
    disallowedTools: [prefixed(LIST_ACCOUNTS)],
    permissionMode: "default",
    // Ignore any ambient MCP config (project .mcp.json, settings, plugins).
    strictMcpConfig: true,
    canUseTool: async (toolName, input) => {
      const decision = resolveToolCall(accountId, toolName, input);
      if (!decision.allowed) {
        return { behavior: "deny", message: decision.reason };
      }
      // Observability (no behavior change): note when the model passed an
      // accountId we had to override — a useful Phase 5 signal that Haiku is
      // mis-passing the id. The injection below makes the value irrelevant.
      const passed = (input as { accountId?: unknown }).accountId;
      if (passed !== undefined && passed !== accountId) {
        console.warn(
          `[qa-agent] ${stripPrefix(toolName)}: overriding model accountId ${JSON.stringify(passed)} with scoped ${accountId}`,
        );
      }
      // The allow arm MUST carry `updatedInput` — the SDK's runtime validation of
      // the permission result requires it (the .d.ts types it optional, but the
      // 0.3.x runtime rejects an allow without it). updatedInput also forces the
      // scoped accountId, so scoping is by construction.
      return { behavior: "allow", updatedInput: decision.updatedInput };
    },
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "stdio",
        command: config.mcpLaunch.command,
        args: [...config.mcpLaunch.args],
        env: mcpChildEnv(config.databaseUrl),
        // Keep the 4 tools in context (don't defer them behind tool search).
        alwaysLoad: true,
      },
    },
    // `env` REPLACES the subprocess env (it does not merge) — spread process.env
    // so the agent keeps PATH/HOME, and ensure it carries the API key. (The agent
    // subprocess thus receives the full parent env, which is unavoidable here.)
    env: { ...process.env, ANTHROPIC_API_KEY: config.apiKey },
  };
}

/**
 * Environment for the MCP child: inherit `process.env` (for `PATH` / node + tsx
 * resolution) but **drop `ANTHROPIC_API_KEY`** — the MCP server never calls the
 * API, so least privilege keeps the key out of its process — then inject the
 * `DATABASE_URL` it does need.
 */
function mcpChildEnv(databaseUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ANTHROPIC_API_KEY") {
      env[key] = value;
    }
  }
  env.DATABASE_URL = databaseUrl;
  return env;
}

/** The single `result` message in the stream, or `undefined` if absent. */
function resultMessage(messages: readonly SDKMessage[]): SDKResultMessage | undefined {
  return messages.find((message): message is SDKResultMessage => message.type === "result");
}

export interface ExtractedAnswer {
  readonly answer: string;
  readonly turns: number;
}

/**
 * Reduce the message stream to the final answer + turn count. `success` →
 * the model's text; `error_max_turns` / `error_max_budget_usd` → the graceful
 * step-limit message (a budget/complexity limit the user can act on, not a
 * fault); `error_during_execution` (or no result) → `AgentExecutionError` (502).
 */
export function extractAnswer(messages: readonly SDKMessage[]): ExtractedAnswer {
  const result = resultMessage(messages);
  if (result === undefined) {
    throw new AgentExecutionError("the agent returned no result");
  }
  if (result.subtype === "success") {
    // A success with no text (e.g. the model ended on tool calls only) must not
    // surface as a blank answer.
    const answer = result.result.trim() === "" ? NO_ANSWER_MESSAGE : result.result;
    return { answer, turns: result.num_turns };
  }
  if (result.subtype === "error_max_turns" || result.subtype === "error_max_budget_usd") {
    return { answer: STEP_LIMIT_MESSAGE, turns: result.num_turns };
  }
  throw new AgentExecutionError(`the agent failed: ${result.subtype}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Pull every tool call the **main agent** made, in order, with the domain
 * (stripped) name. Sub-agent messages (`parent_tool_use_id !== null`) are excluded
 * — the trail is the agent's own work, and sub-agents are disabled anyway (no Task
 * tool; see `buildAskOptions`), so this is a guard against a future regression.
 */
export function extractToolCalls(messages: readonly SDKMessage[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const message of messages) {
    if (message.type !== "assistant" || message.parent_tool_use_id !== null) {
      continue;
    }
    for (const block of message.message.content) {
      if (block.type === "tool_use") {
        calls.push({ tool: stripPrefix(block.name), input: asRecord(block.input) });
      }
    }
  }
  return calls;
}

/** Total cost of a run (for server-side logging; never returned to the client). */
export function totalCostUsd(messages: readonly SDKMessage[]): number {
  return resultMessage(messages)?.total_cost_usd ?? 0;
}
