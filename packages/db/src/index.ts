/**
 * @ledger-lens/db — the persistence layer (Drizzle schema, client, migrations,
 * seed, and the deterministic read/write repositories).
 *
 * Promoted out of `apps/api` into a shared package once it gained a second
 * consumer (the Phase 3 domain MCP server) alongside the HTTP API — see ADR-0007.
 * Dependency graph: `@ledger-lens/shared` <- `@ledger-lens/db` <- { apps/api,
 * packages/mcp-server }. No NestJS / HTTP / LLM here.
 */
export * from "./schema.js";
export * from "./client.js";
export * from "./repository.js";
export * from "./accounts.repository.js";
export * from "./categorization.repository.js";
export * from "./migrate.js";
export * from "./seed.js";
export * from "./demo-seed.js";
