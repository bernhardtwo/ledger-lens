import { argv } from "node:process";
import { pathToFileURL } from "node:url";
/**
 * Deterministic **demo seed** (see ADR-0009, spec 0005). A committed, reproducible
 * account state for the Phase 5 eval harness — and a realistic dev/demo dataset.
 *
 * Determinism-first: the transactions, their dates/amounts/directions AND their
 * **categories are fixed data applied by rule** here — the LLM categoriser is NOT
 * involved, so the world the evals score against is fully reproducible. The eval
 * harness derives its ground-truth figures from {@link DEMO_SEED} via the same
 * money folds the MCP tools use, and a unit test asserts the committed figures
 * equal what these rows produce (the dataset can't drift from the seed).
 *
 * Idempotent: built on `persistIngestion` (`ON CONFLICT (account_id, fingerprint)
 * DO NOTHING`) + `applyCategorizations` (guarded by `category IS NULL`), so running
 * it repeatedly is a no-op after the first run.
 */
import type { Category, Direction } from "@ledger-lens/shared";
import { type Money, isoDate, money, toDecimalString } from "@ledger-lens/shared";
import { applyCategorizations } from "./categorization.repository.js";
import { type Database, createDatabase } from "./client.js";
import { listTransactions, persistIngestion } from "./repository.js";
import { SEED_ACCOUNTS, type SeedAccount, seedAccounts } from "./seed.js";

/** One fixed transaction in the demo seed. `amountMinor` is a non-negative magnitude. */
export interface DemoSeedRow {
  /** Calendar date the transaction occurred (`YYYY-MM-DD`). */
  readonly date: string;
  readonly description: string;
  readonly direction: Direction;
  /** Magnitude in minor units (cents) — the account's currency is implied. */
  readonly amountMinor: bigint;
  /** The category assigned **by rule** (never by the LLM in the seed). */
  readonly category: Category;
}

/** The fixed transaction set for one seeded account. */
export interface DemoAccountSeed {
  readonly account: SeedAccount;
  readonly rows: readonly DemoSeedRow[];
}

const [USD_ACCOUNT, EUR_ACCOUNT] = SEED_ACCOUNTS;

/**
 * The committed demo world. Round figures and an out-of-month payroll (so "net in
 * May" ≠ "net all-time") keep the golden ground truth easy to read and verify. The
 * EUR account uses **distinct magnitudes** from the USD account, so any account
 * scope leak in the agent would change a figure the evals assert.
 */
export const DEMO_SEED: readonly DemoAccountSeed[] = [
  {
    account: USD_ACCOUNT,
    rows: [
      // April payroll — only counted by all-time questions, not "in May".
      {
        date: "2026-04-28",
        description: "ACME PAYROLL",
        direction: "credit",
        amountMinor: 500000n,
        category: "income",
      },
      // May.
      {
        date: "2026-05-01",
        description: "ACME PAYROLL",
        direction: "credit",
        amountMinor: 500000n,
        category: "income",
      },
      {
        date: "2026-05-02",
        description: "WHOLE FOODS",
        direction: "debit",
        amountMinor: 12500n,
        category: "groceries",
      },
      {
        date: "2026-05-05",
        description: "TRADER JOES",
        direction: "debit",
        amountMinor: 7500n,
        category: "groceries",
      },
      {
        date: "2026-05-07",
        description: "SHELL GAS",
        direction: "debit",
        amountMinor: 6000n,
        category: "transport",
      },
      {
        date: "2026-05-09",
        description: "UBER RIDE",
        direction: "debit",
        amountMinor: 2500n,
        category: "transport",
      },
      {
        date: "2026-05-10",
        description: "BLUE BOTTLE COFFEE",
        direction: "debit",
        amountMinor: 1500n,
        category: "dining",
      },
      {
        date: "2026-05-12",
        description: "CHIPOTLE",
        direction: "debit",
        amountMinor: 2000n,
        category: "dining",
      },
      {
        date: "2026-05-15",
        description: "CITY APARTMENTS RENT",
        direction: "debit",
        amountMinor: 200000n,
        category: "housing",
      },
      {
        date: "2026-05-18",
        description: "NETFLIX",
        direction: "debit",
        amountMinor: 1599n,
        category: "subscriptions",
      },
      {
        date: "2026-05-20",
        description: "AMAZON MARKETPLACE",
        direction: "debit",
        amountMinor: 4999n,
        category: "shopping",
      },
      {
        date: "2026-05-25",
        description: "CITY POWER AND LIGHT",
        direction: "debit",
        amountMinor: 8000n,
        category: "utilities",
      },
      {
        date: "2026-05-28",
        description: "FITNESS CLUB",
        direction: "debit",
        amountMinor: 3000n,
        category: "health",
      },
    ],
  },
  {
    account: EUR_ACCOUNT,
    rows: [
      {
        date: "2026-05-02",
        description: "NOMINA EMPRESA SL",
        direction: "credit",
        amountMinor: 300000n,
        category: "income",
      },
      {
        date: "2026-05-04",
        description: "MERCADONA",
        direction: "debit",
        amountMinor: 8000n,
        category: "groceries",
      },
      {
        date: "2026-05-06",
        description: "CARREFOUR",
        direction: "debit",
        amountMinor: 5000n,
        category: "groceries",
      },
      {
        date: "2026-05-10",
        description: "RENFE VIAJES",
        direction: "debit",
        amountMinor: 4500n,
        category: "transport",
      },
      {
        date: "2026-05-14",
        description: "ALQUILER PISO",
        direction: "debit",
        amountMinor: 95000n,
        category: "housing",
      },
      {
        date: "2026-05-20",
        description: "SPOTIFY",
        direction: "debit",
        amountMinor: 999n,
        category: "subscriptions",
      },
      {
        date: "2026-05-22",
        description: "ZARA",
        direction: "debit",
        amountMinor: 6000n,
        category: "shopping",
      },
      {
        date: "2026-05-26",
        description: "ENDESA ENERGIA",
        direction: "debit",
        amountMinor: 7000n,
        category: "utilities",
      },
    ],
  },
];

function toDraft(account: SeedAccount, row: DemoSeedRow, index: number) {
  const amount: Money = money(row.amountMinor, account.currency);
  return {
    accountId: account.id,
    transactionDate: isoDate(row.date),
    postedDate: null,
    description: row.description,
    direction: row.direction,
    amount,
    // Stable, unique per (account, row) so re-seeding is idempotent.
    fingerprint: `demo-${account.id}-${index}`,
    rawRow: {
      date: row.date,
      description: row.description,
      direction: row.direction,
      amount: toDecimalString(amount),
    } satisfies Record<string, string>,
  };
}

/**
 * Fixed `categorized_at` so a fresh DB is byte-identical across runs. Categories
 * feed no money fold (timestamps never affect a figure), but a "reproducible seed"
 * shouldn't stamp wall-clock time. Callers wanting "now" can pass their own.
 */
const SEED_CATEGORIZED_AT = new Date("2026-06-01T00:00:00.000Z");

/** Read every transaction for an account across all keyset pages (no 200-row cap). */
async function listAllTransactions(db: Database, accountId: string) {
  const items = [];
  let cursor: string | null = null;
  do {
    const page = await listTransactions(db, { accountId, limit: 200, cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

/**
 * Seed (or top up) the committed demo world into `db`. Ensures the accounts exist,
 * persists each account's fixed transactions, then applies the committed category
 * labels by rule. Idempotent across runs.
 */
export async function seedDemo(
  db: Database,
  categorizedAt: Date = SEED_CATEGORIZED_AT,
): Promise<void> {
  await seedAccounts(db);
  for (const { account, rows } of DEMO_SEED) {
    await persistIngestion(db, {
      accountId: account.id,
      sourceFilename: `demo-${account.id}.csv`,
      profileId: "demo@v1",
      accepted: rows.map((row, index) => toDraft(account, row, index)),
    });
    const categoryByDescription = new Map<string, Category>(
      rows.map((row) => [row.description, row.category]),
    );
    // Page through ALL rows — `listTransactions` clamps `limit` to 200 per page, so
    // a single call would silently leave later rows uncategorized as the seed grows.
    const persisted = await listAllTransactions(db, account.id);
    const assignments = persisted.flatMap((item) => {
      const category = categoryByDescription.get(item.description);
      return category ? [{ id: item.id, category }] : [];
    });
    await applyCategorizations(db, assignments, "demo-seed", categorizedAt);
  }
}

/** CLI entry: seed the demo world into the database at `DATABASE_URL`, then close. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required to seed the demo world");
  }
  const { db, client } = createDatabase(url);
  try {
    await seedDemo(db);
  } finally {
    await client.end();
  }
}

const entry = argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
