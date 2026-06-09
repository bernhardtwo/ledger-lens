/**
 * @ledger-lens/mcp-server — the domain MCP server (read-only deterministic tools
 * over the persisted financial domain). See ADR-0007 / spec 0003.
 *
 * Besides the server, the tool handlers, their Zod schemas, and the pure money
 * folds are exported so other deterministic consumers can reuse them directly
 * (the Phase 5 eval harness re-executes the handlers to reconstruct the figures
 * the agent saw, and verifies committed ground truth against the folds).
 */
export { createMcpServer } from "./server.js";
export * from "./aggregation.js";
export * from "./schemas.js";
export * from "./tools.js";
