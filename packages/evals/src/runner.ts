/**
 * The `AgentRunner` port (see ADR-0009 §8). The harness depends on this seam; the
 * real implementation — which calls the Claude Agent SDK over the real MCP tools —
 * lives in `apps/api` (a package must not depend on an app, ADR-0007). The unit
 * tests inject a mock that returns canned outputs, so no suite here hits the API.
 */

/** One tool call the agent made: the domain (prefix-stripped) name + the input it passed. */
export interface AgentToolCall {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

/** The raw result of running the agent on one question. */
export interface AgentRunOutput {
  readonly answer: string;
  readonly toolCalls: readonly AgentToolCall[];
  readonly model: string;
  readonly turns: number;
  /** Run cost in USD (logged server-side by the adapter; surfaced here for the report). */
  readonly costUsd: number;
}

/** The agent seam: ask one account-scoped question, get the answer + the tools it used. */
export interface AgentRunner {
  run(input: { readonly accountId: string; readonly question: string }): Promise<AgentRunOutput>;
}
