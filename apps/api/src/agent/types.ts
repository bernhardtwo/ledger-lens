/**
 * Q&A agent port + DTOs (see spec 0004, ADR-0008). SDK-free — these describe the
 * mockable seam: the HTTP layer depends on `QaAgent`, the production adapter wraps
 * the Claude Agent SDK, and tests inject a scripted double. No suite hits the real
 * API through this interface.
 */

/** One tool the agent invoked, with the domain (prefix-stripped) name + its input. */
export interface ToolCall {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

/** The agent's answer to one question: phrasing + the tools it used + run metadata. */
export interface QaAnswer {
  readonly answer: string;
  readonly toolCalls: readonly ToolCall[];
  /** Model that produced the answer (for the response `meta`). */
  readonly model: string;
  /** Agentic turns taken (for the response `meta`). */
  readonly turns: number;
  /**
   * Run cost in USD. Logged server-side and **never** returned in the HTTP
   * response (ADR-0008 §6); surfaced here only so the Phase 5 eval report can
   * record per-question cost. Optional: the scripted test double omits it.
   */
  readonly costUsd?: number;
}

/** The agent seam. The only thing that orchestrates the LLM; mocked in every test. */
export interface QaAgent {
  ask(input: { readonly accountId: string; readonly question: string }): Promise<QaAnswer>;
}

/**
 * The agent loop failed mid-run (SDK `error_during_execution`) — a server-side
 * fault, mapped to `502` by the HTTP layer. A typed error (not a bare `Error`) so
 * the edge maps it without string-matching, and so a missing-key/config error
 * (a different `Error`) is *not* swallowed as a `502`.
 */
export class AgentExecutionError extends Error {
  override readonly name = "AgentExecutionError";
}
