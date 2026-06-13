/**
 * Manual SSE smoke — **NOT a test suite**; the streaming sibling of `smoke:ask`
 * (ADR-0010). Boots the real Nest app (real Agent SDK + real MCP over stdio + real
 * DB) and consumes `POST /accounts/:id/ask/stream` over HTTP, printing the raw
 * `data:` AgentEvent frames exactly as a `curl -N` would. Run with
 * `ANTHROPIC_API_KEY` + `DATABASE_URL` set, against a seeded + categorized account:
 *   pnpm --filter @ledger-lens/api smoke:ask-stream -- <accountId> "your question"
 * Defaults to the first seeded account + a sample question. A `.ts` (not
 * `.test.ts`/`.itest.ts`), so no vitest run picks it up.
 */
import "reflect-metadata";
import { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { SEED_ACCOUNTS } from "@ledger-lens/db";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../http/app.module.js";

const DEFAULT_QUESTION = "What was my net cash flow, and which category did I spend the most on?";
const PORT = 3009;

async function main(): Promise<void> {
  // pnpm forwards its own `--` separator into argv; drop a leading one so both
  // `pnpm smoke:ask-stream -- <id> "q"` and a direct `node` invocation work.
  const args = argv[2] === "--" ? argv.slice(3) : argv.slice(2);
  const accountId = args[0] ?? SEED_ACCOUNTS[0]?.id ?? "";
  const question = args.slice(1).join(" ").trim() || DEFAULT_QUESTION;
  if (accountId === "") {
    stdout.write("usage: smoke:ask-stream -- <accountId> <question>\n");
    return;
  }

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(PORT);
  stdout.write(
    `account: ${accountId}\nQ: ${question}\n\nPOST /accounts/${accountId}/ask/stream\n\n`,
  );
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/accounts/${accountId}/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    stdout.write(`HTTP ${res.status} content-type=${res.headers.get("content-type")}\n\n`);
    if (res.body === null) {
      stdout.write("(no body)\n");
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        stdout.write(decoder.decode(value, { stream: true }));
      }
    }
  } finally {
    await app.close();
  }
}

const entry = argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
