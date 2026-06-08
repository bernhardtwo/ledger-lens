/**
 * Ask service — the thin orchestration edge (see spec 0004). It 404s an unknown
 * account *before* spending any tokens, delegates the question to the injected
 * `QaAgent`, and maps an agent-execution fault to `502`. No LLM/tool/money logic
 * of its own — all of that is the agent + the deterministic MCP tools.
 */
import { type Database, getAccountById } from "@ledger-lens/db";
import { BadGatewayException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AgentExecutionError, type QaAgent } from "../../agent/types.js";
import { DATABASE } from "../database/database.tokens.js";
import type { AskResponse } from "./ask.dto.js";
import { QA_AGENT } from "./ask.tokens.js";

@Injectable()
export class AskService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(QA_AGENT) private readonly agent: QaAgent,
  ) {}

  async ask(accountId: string, question: string): Promise<AskResponse> {
    const account = await getAccountById(this.db, accountId);
    if (account === null) {
      throw new NotFoundException(`account ${accountId} not found`);
    }

    try {
      const result = await this.agent.ask({ accountId, question });
      return {
        answer: result.answer,
        toolCalls: result.toolCalls.map((call) => ({ tool: call.tool, input: call.input })),
        meta: { model: result.model, turns: result.turns },
      };
    } catch (error) {
      // The agent loop faulted mid-run — a server-side problem, not the user's.
      // A config error (e.g. missing key) is a different error and bubbles to 500.
      if (error instanceof AgentExecutionError) {
        throw new BadGatewayException("the agent could not complete the request");
      }
      throw error;
    }
  }
}
