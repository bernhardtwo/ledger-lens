/**
 * The real `AgentRunner` (see ADR-0009 §8): the `@ledger-lens/evals` port
 * implemented with the production `AgentSdkQaAgent`. This is the seam that lets the
 * harness stay app-independent — the package depends on the port, this app supplies
 * the real agent. The only eval-side code that reaches the Claude API + MCP tools.
 */
import type { AgentRunOutput, AgentRunner } from "@ledger-lens/evals";
import { type AgentRuntimeConfig, AgentSdkQaAgent } from "../agent/agent-sdk-client.js";

export class AgentSdkRunner implements AgentRunner {
  private readonly agent: AgentSdkQaAgent;

  constructor(runtime: AgentRuntimeConfig) {
    this.agent = new AgentSdkQaAgent(runtime);
  }

  async run({
    accountId,
    question,
  }: { accountId: string; question: string }): Promise<AgentRunOutput> {
    const result = await this.agent.ask({ accountId, question });
    return {
      answer: result.answer,
      toolCalls: result.toolCalls.map((call) => ({ tool: call.tool, input: call.input })),
      model: result.model,
      turns: result.turns,
      costUsd: result.costUsd ?? 0,
    };
  }
}
