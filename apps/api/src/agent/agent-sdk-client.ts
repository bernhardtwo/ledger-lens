/**
 * Production `QaAgent` + `StreamingQaAgent` over the Claude Agent SDK (ADR-0008,
 * ADR-0010). The one place `query()` is called — the only path that spawns the
 * agent subprocess + the MCP server and reaches the real API. Intentionally thin:
 * classification lives in the pure helpers (`stream.ts`; `query.ts`'s `extract*`
 * remain the parity oracle), so only the live `query()` call is smoke-only; tests
 * inject a scripted double.
 *
 * `/ask` (`ask`) and SSE (`askStream`) share ONE classifier (`stream.ts`) over the
 * same `query()` loop, so the two transports cannot drift. `ask` folds the message
 * stream via `foldMessages` (which re-throws a terminal error -> 502, byte-identical
 * to the pre-stream extract path) and keeps `costUsd`; `askStream` yields the same
 * mapped events live and wires the SDK `abortController` so a dropped client cancels
 * the loop.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@ledger-lens/shared";
import { Logger } from "@nestjs/common";
import { instrumentAgentRun } from "../observability/telemetry.js";
import { mcpServerLaunch } from "./mcp-launch.js";
import { type AgentConfig, buildAskOptions } from "./query.js";
import { createEventMapper, foldMessages } from "./stream.js";
import {
  AgentExecutionError,
  type QaAgent,
  type QaAnswer,
  type StreamingQaAgent,
} from "./types.js";

export const DEFAULT_AGENT_MODEL = "claude-haiku-4-5";
export const DEFAULT_MAX_TURNS = 8;
export const DEFAULT_MAX_BUDGET_USD = 0.15;

/** The parametrized config the module reads from env; the rest is resolved per call. */
export interface AgentRuntimeConfig {
  readonly model: string;
  readonly maxTurns: number;
  readonly maxBudgetUsd: number;
}

export class AgentSdkQaAgent implements QaAgent, StreamingQaAgent {
  private readonly logger = new Logger(AgentSdkQaAgent.name);

  constructor(private readonly runtime: AgentRuntimeConfig) {}

  /**
   * `/ask`: collect the message stream and fold it to the answer (a terminal error
   * -> thrown `AgentExecutionError` -> 502), keeping `costUsd`. Byte-identical to the
   * pre-stream extract path — pinned by the parity test over `foldMessages`.
   */
  async ask({ accountId, question }: { accountId: string; question: string }): Promise<QaAnswer> {
    const messages = await this.collect(accountId, question);
    const answer = foldMessages(messages, this.runtime.model);
    // Cost/usage are logged server-side only — never returned to the client.
    this.logger.log(
      `ask account=${accountId} model=${this.runtime.model} turns=${answer.turns} tools=${answer.toolCalls.length} cost_usd=${(answer.costUsd ?? 0).toFixed(6)}`,
    );
    return answer;
  }

  /**
   * Streaming form (ADR-0010): yields a mapped `AgentEvent` per `SDKMessage` over the
   * same `query()` loop. A loop fault becomes a terminal `error` event (an open
   * stream can't change its HTTP status); a missing key / `DATABASE_URL` still throws
   * before the first event, so the SSE service surfaces it as a pre-stream 500. The
   * optional `controller` lets the caller abort the agent when the client disconnects.
   */
  async *askStream(
    { accountId, question }: { accountId: string; question: string },
    controller?: AbortController,
  ): AsyncGenerator<AgentEvent> {
    const options = buildAskOptions(this.config(), accountId);
    if (controller !== undefined) {
      options.abortController = controller;
    }
    const mapper = createEventMapper(this.runtime.model);
    const run = instrumentAgentRun(
      { accountId, model: this.runtime.model, streaming: true },
      query({ prompt: question, options }),
    );
    try {
      for await (const message of run) {
        yield* mapper.push(message);
      }
    } catch {
      yield* mapper.fail();
      return;
    }
    yield* mapper.end();
  }

  /** The shared `query()` loop for `ask`: collect every message; a loop fault -> 502. */
  private async collect(accountId: string, question: string): Promise<SDKMessage[]> {
    const options = buildAskOptions(this.config(), accountId);
    const messages: SDKMessage[] = [];
    const run = instrumentAgentRun(
      { accountId, model: this.runtime.model, streaming: false },
      query({ prompt: question, options }),
    );
    try {
      for await (const message of run) {
        messages.push(message);
      }
    } catch (error) {
      // The loop faulted mid-run (spawn/stream/transport failure) -> 502 (ADR-0008
      // §7). The missing key / DATABASE_URL guards in config() throw a plain Error
      // before this and stay a 500 (misconfiguration).
      throw new AgentExecutionError(
        `the agent loop failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return messages;
  }

  /**
   * Resolve secrets lazily so the app boots without them (the key is only needed to
   * actually answer; `DATABASE_URL` is also required by `DatabaseModule`).
   */
  private config(): AgentConfig {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error("ANTHROPIC_API_KEY is required to answer questions");
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl === "") {
      throw new Error("DATABASE_URL is required to answer questions");
    }
    return { ...this.runtime, databaseUrl, apiKey, mcpLaunch: mcpServerLaunch() };
  }
}
