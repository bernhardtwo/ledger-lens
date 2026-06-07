/**
 * Manual smoke test — **NOT a test suite, the ONLY path that calls the real Claude
 * API**. Run with `ANTHROPIC_API_KEY` set:
 *   pnpm --filter @ledger-lens/api smoke:categorize
 * Categorizes a tiny fixed sample and prints the result; costs a few tokens. It is
 * a `.ts` (not `.test.ts`/`.itest.ts`), so no vitest run picks it up.
 */
import { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { AnthropicCategorizationClient, DEFAULT_CATEGORIZATION_MODEL } from "./anthropic-client.js";
import { categorizeTransactions } from "./core.js";
import type { CategorizableTransaction } from "./types.js";

const SAMPLE: readonly CategorizableTransaction[] = [
  {
    id: "1",
    description: "WHOLE FOODS MARKET #123",
    direction: "debit",
    amountMinor: 5499n,
    currencyCode: "USD",
  },
  {
    id: "2",
    description: "ACME CORP PAYROLL",
    direction: "credit",
    amountMinor: 250000n,
    currencyCode: "USD",
  },
  {
    id: "3",
    description: "NETFLIX.COM",
    direction: "debit",
    amountMinor: 1599n,
    currencyCode: "USD",
  },
  {
    id: "4",
    description: "UBER TRIP 8F2K HELP.UBER.COM",
    direction: "debit",
    amountMinor: 1820n,
    currencyCode: "USD",
  },
];

async function main(): Promise<void> {
  const client = new AnthropicCategorizationClient(
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_CATEGORIZATION_MODEL ?? DEFAULT_CATEGORIZATION_MODEL,
  );
  const run = await categorizeTransactions(SAMPLE, client);
  for (const transaction of SAMPLE) {
    const category = run.assignments.get(transaction.id) ?? "(failed)";
    stdout.write(`${transaction.description}  ->  ${category}\n`);
  }
  if (run.failedIds.length > 0) {
    stdout.write(`failed (left for retry): ${run.failedIds.join(", ")}\n`);
  }
}

const entry = argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
