import { Module } from "@nestjs/common";
import {
  type AgentRuntimeConfig,
  AgentSdkQaAgent,
  DEFAULT_AGENT_MODEL,
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_TURNS,
} from "../../agent/agent-sdk-client.js";
import type { QaAgent, StreamingQaAgent } from "../../agent/types.js";
import { DatabaseModule } from "../database/database.module.js";
import { AskStreamService } from "./ask-stream.service.js";
import { AskController } from "./ask.controller.js";
import { AskService } from "./ask.service.js";
import { QA_AGENT } from "./ask.tokens.js";

// Upper clamps so a fat-fingered env var (e.g. MAX_BUDGET_USD=15 meaning 0.15)
// can't blow past the guardrail it exists to enforce.
const MAX_TURNS_CEILING = 50;
const MAX_BUDGET_USD_CEILING = 1;

/** Parse a positive integer env var, clamped to `max`, falling back to `fallback`. */
function intEnv(raw: string | undefined, fallback: number, max: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

/** Parse a positive float env var, clamped to `max`, falling back to `fallback`. */
function floatEnv(raw: string | undefined, fallback: number, max: number): number {
  const value = Number.parseFloat(raw ?? "");
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

function runtimeConfig(): AgentRuntimeConfig {
  return {
    model: process.env.ANTHROPIC_AGENT_MODEL ?? DEFAULT_AGENT_MODEL,
    maxTurns: intEnv(process.env.ANTHROPIC_AGENT_MAX_TURNS, DEFAULT_MAX_TURNS, MAX_TURNS_CEILING),
    maxBudgetUsd: floatEnv(
      process.env.ANTHROPIC_AGENT_MAX_BUDGET_USD,
      DEFAULT_MAX_BUDGET_USD,
      MAX_BUDGET_USD_CEILING,
    ),
  };
}

@Module({
  imports: [DatabaseModule],
  controllers: [AskController],
  providers: [
    AskService,
    AskStreamService,
    {
      // One adapter instance implements both the JSON (`ask`) and SSE (`askStream`)
      // seams; the adapter reads the API key lazily, so app boot needs none. Tests
      // override this token with a scripted double (no real API call anywhere).
      provide: QA_AGENT,
      useFactory: (): QaAgent & StreamingQaAgent => new AgentSdkQaAgent(runtimeConfig()),
    },
  ],
})
export class AskModule {}
