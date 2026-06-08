/**
 * Deterministic account-scope guard (see ADR-0008 §3). This is the **hard,
 * code-enforced boundary** — not a prompt wish. The production adapter wires it
 * into the Agent SDK's `canUseTool` callback; the scripted test double calls it on
 * the same path. Pure and exhaustively unit-tested.
 *
 * Scoping works by **injection, not rejection**: an allowed call's `accountId` is
 * overwritten with the scoped one (via `canUseTool`'s `updatedInput`), so the
 * model's `accountId` value can never matter — it cannot target another account
 * even by passing a different id. `list_accounts` and any built-in/unknown tool
 * are denied outright. (`allowedTools` is deliberately not used to scope: the SDK
 * defines it as a no-prompt list, not a restriction, so it cannot be the boundary.)
 */

/** Our MCP server's name and the tool-name prefix the Agent SDK assigns it. */
export const MCP_SERVER_NAME = "ledgerlens";
export const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** The cross-account tool — hidden from the model and denied by the guard. */
export const LIST_ACCOUNTS = "list_accounts";

/** The only tools a single-account question may use; each takes an `accountId`. */
export const ACCOUNT_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  "get_account",
  "list_transactions",
  "summarize_spending_by_category",
  "summarize_account",
]);

/** Strip the `mcp__ledgerlens__` prefix to the bare domain tool name (no-op if absent). */
export function stripPrefix(toolName: string): string {
  return toolName.startsWith(TOOL_PREFIX) ? toolName.slice(TOOL_PREFIX.length) : toolName;
}

/** Add the `mcp__ledgerlens__` prefix to a domain tool name (for `disallowedTools`). */
export function prefixed(domainTool: string): string {
  return `${TOOL_PREFIX}${domainTool}`;
}

export type ScopeDecision =
  /** Allowed — run the tool with `updatedInput` (the scoped `accountId` injected). */
  | { readonly allowed: true; readonly updatedInput: Record<string, unknown> }
  | { readonly allowed: false; readonly reason: string };

/**
 * Resolve a tool call for `scopedAccountId`. Allows only the four account-scoped
 * tools and, when allowed, returns `updatedInput` with the scoped `accountId`
 * forced in — so whatever id the model passed (a different account, a garbled
 * UUID, or none) is overwritten and the call can only ever touch the scoped
 * account. `list_accounts` and any built-in/unknown tool are denied. The denial
 * `reason` is surfaced to the model so it can adjust.
 */
export function resolveToolCall(
  scopedAccountId: string,
  toolName: string,
  input: Record<string, unknown>,
): ScopeDecision {
  const tool = stripPrefix(toolName);
  if (!ACCOUNT_SCOPED_TOOLS.has(tool)) {
    return {
      allowed: false,
      reason: `tool '${tool}' is not permitted for a single-account question`,
    };
  }
  return { allowed: true, updatedInput: { ...input, accountId: scopedAccountId } };
}
