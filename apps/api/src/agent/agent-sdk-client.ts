/**
 * Production `QaAgent` over the Claude Agent SDK (see ADR-0008). This is the one
 * place `query()` is called — the only path that spawns the agent subprocess and
 * the MCP server and reaches the real API. It is intentionally thin: all logic
 * lives in the pure helpers in `query.ts` (unit-tested), so only this live call is
 * exercised by `smoke:ask`, never by CI. Tests inject a scripted double instead.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Logger } from "@nestjs/common";
import { mcpServerLaunch } from "./mcp-launch.js";
import {
  type AgentConfig,
  buildAskOptions,
  extractAnswer,
  extractToolCalls,
  totalCostUsd,
} from "./query.js";
import { AgentExecutionError, type QaAgent, type QaAnswer } from "./types.js";

export const DEFAULT_AGENT_MODEL = "claude-haiku-4-5";
export const DEFAULT_MAX_TURNS = 8;
export const DEFAULT_MAX_BUDGET_USD = 0.15;

/** The parametrized config the module reads from env; the rest is resolved per call. */
export interface AgentRuntimeConfig {
  readonly model: string;
  readonly maxTurns: number;
  readonly maxBudgetUsd: number;
}

export class AgentSdkQaAgent implements QaAgent {
  private readonly logger = new Logger(AgentSdkQaAgent.name);

  constructor(private readonly runtime: AgentRuntimeConfig) {}

  async ask({ accountId, question }: { accountId: string; question: string }): Promise<QaAnswer> {
    // Read secrets lazily so the app boots without them (DATABASE_URL is also
    // required by DatabaseModule; the key is only needed to actually answer).
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error("ANTHROPIC_API_KEY is required to answer questions");
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl === "") {
      throw new Error("DATABASE_URL is required to answer questions");
    }

    const config: AgentConfig = {
      ...this.runtime,
      databaseUrl,
      apiKey,
      mcpLaunch: mcpServerLaunch(),
    };
    const options = buildAskOptions(config, accountId);

    const messages: SDKMessage[] = [];
    try {
      for await (const message of query({ prompt: question, options })) {
        messages.push(message);
      }
    } catch (error) {
      // The loop faulted mid-run (spawn/stream/transport failure). Surface it as an
      // execution error -> 502 (ADR-0008 §7); the missing key / DATABASE_URL guards
      // above throw a plain Error before this, and stay a 500 (misconfiguration).
      throw new AgentExecutionError(
        `the agent loop failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const { answer, turns } = extractAnswer(messages);
    const toolCalls = extractToolCalls(messages);
    const costUsd = totalCostUsd(messages);
    // Cost/usage are logged server-side only — never returned to the client. The
    // `costUsd` on the result is for the eval report, not the HTTP response (which
    // maps only answer/toolCalls/meta).
    this.logger.log(
      `ask account=${accountId} model=${this.runtime.model} turns=${turns} tools=${toolCalls.length} cost_usd=${costUsd.toFixed(6)}`,
    );
    return { answer, toolCalls, model: this.runtime.model, turns, costUsd };
  }
}
