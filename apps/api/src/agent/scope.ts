/**
 * Deterministic account-scope guard (see ADR-0008 §3). This is the **hard,
 * code-enforced boundary** — not a prompt wish. The production adapter wires it
 * into the Agent SDK's `canUseTool` callback; the scripted test double calls it on
 * the same path. Pure and exhaustively unit-tested.
 *
 * `allowedTools` is deliberately not used to scope: the SDK defines it as a
 * no-prompt list, not a restriction, so it cannot be the boundary. This is.
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
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Decide whether a tool call is in scope for `scopedAccountId`. Allows only the
 * four account-scoped tools, and only when the call's `accountId` equals the
 * scoped one. Everything else — `list_accounts`, any built-in/unknown tool, a
 * foreign or missing `accountId` — is denied. No foreign-account read reaches the
 * DB.
 */
export function assertInScope(
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
  if (input.accountId !== scopedAccountId) {
    return {
      allowed: false,
      reason: `this question is scoped to account ${scopedAccountId}; tool calls may not access another account`,
    };
  }
  return { allowed: true };
}
