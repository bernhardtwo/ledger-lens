/**
 * Domain MCP server entrypoint — stdio transport (see ADR-0007). The Phase 4
 * agent (and Claude Desktop) spawn this as a subprocess and talk MCP over stdio.
 * Reads `DATABASE_URL` (server-side only) and reuses `createDatabase`.
 */
import { createDatabase } from "@ledger-lens/db";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required to run the MCP server");
  }
  const { db, client } = createDatabase(url);
  const server = createMcpServer(db);

  // Close the DB pool exactly once. A host stops an MCP subprocess by closing our
  // stdio (surfaced as the server's `onclose`), not only via a POSIX signal — so
  // we must release the pool on both paths or it leaks until the process is killed.
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await client.end({ timeout: 5 });
    process.exit(0);
  };

  server.server.onclose = () => void shutdown();
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  // stderr only — stdout is the MCP protocol channel. Log `message`, never the
  // error object, so a driver error can't widen the DATABASE_URL into the log.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
