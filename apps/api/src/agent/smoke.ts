/**
 * Manual smoke test — **NOT a test suite, the ONLY path that calls the real Claude
 * API** (real Agent SDK + real MCP server over stdio). Run with `ANTHROPIC_API_KEY`
 * + `DATABASE_URL` set, against an account that has been ingested + categorized:
 *   pnpm --filter @ledger-lens/api smoke:ask -- <accountId> "your question"
 * Defaults to the first seeded account and a sample question. It is a `.ts` (not
 * `.test.ts`/`.itest.ts`), so no vitest run picks it up.
 */
import { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { SEED_ACCOUNTS } from "@ledger-lens/db";
import {
  AgentSdkQaAgent,
  DEFAULT_AGENT_MODEL,
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_TURNS,
} from "./agent-sdk-client.js";

const DEFAULT_QUESTION = "What was my net cash flow, and which category did I spend the most on?";

async function main(): Promise<void> {
  const accountId = argv[2] ?? SEED_ACCOUNTS[0]?.id ?? "";
  const question = argv.slice(3).join(" ").trim() || DEFAULT_QUESTION;
  if (accountId === "") {
    stdout.write("usage: smoke:ask -- <accountId> <question>\n");
    return;
  }

  const agent = new AgentSdkQaAgent({
    model: process.env.ANTHROPIC_AGENT_MODEL ?? DEFAULT_AGENT_MODEL,
    maxTurns: DEFAULT_MAX_TURNS,
    maxBudgetUsd: DEFAULT_MAX_BUDGET_USD,
  });

  stdout.write(`account: ${accountId}\nQ: ${question}\n\n`);
  const result = await agent.ask({ accountId, question });
  stdout.write(`A: ${result.answer}\n\n`);
  const tools = result.toolCalls.map((call) => call.tool).join(", ") || "(none)";
  stdout.write(`tools used (${result.toolCalls.length}): ${tools}\n`);
  stdout.write(`model=${result.model} turns=${result.turns}\n`);
}

const entry = argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
