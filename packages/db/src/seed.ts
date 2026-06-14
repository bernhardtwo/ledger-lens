import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
/**
 * Account seeding (see spec 0001). Account CRUD is out of scope this phase, so a
 * small fixed set of accounts with **stable UUIDs** is seeded for dev and reused
 * by the integration tests. Idempotent: `ON CONFLICT (id) DO NOTHING`.
 */
import type { AccountKind, CurrencyCode } from "@ledger-lens/shared";
import { type Database, createDatabase } from "./client.js";
import { accounts } from "./schema.js";

/** A seed account; mirrors the `accounts` row shape with a domain `currency`. */
export interface SeedAccount {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly currency: CurrencyCode;
  readonly kind: AccountKind;
}

/** Fixed accounts seeded for dev/tests. Their ids are stable so tests can rely on them. */
export const SEED_ACCOUNTS = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Everyday Checking",
    institution: "Bank A",
    currency: "USD",
    kind: "bank",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Cuenta Nómina",
    institution: "Banco B",
    currency: "EUR",
    kind: "bank",
  },
] as const satisfies readonly SeedAccount[];

/** Insert the seed accounts, skipping any that already exist. */
export async function seedAccounts(db: Database): Promise<void> {
  await db
    .insert(accounts)
    .values(
      SEED_ACCOUNTS.map((account) => ({
        id: account.id,
        name: account.name,
        institution: account.institution,
        currencyCode: account.currency,
        kind: account.kind,
      })),
    )
    .onConflictDoNothing({ target: accounts.id });
}

/** CLI entry: seed accounts into the database at `DATABASE_URL`, then close the pool. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required to seed accounts");
  }
  const { db, client } = createDatabase(url);
  try {
    await seedAccounts(db);
  } finally {
    await client.end();
  }
}

const entry = argv[1];
// `pnpm deploy` symlinks the package into .pnpm, so argv[1] is the symlink path while
// import.meta.url is the realpath — resolve symlinks so this CLI guard fires from the
// compiled entrypoint too, not only in dev (ADR-0012).
if (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  await main();
}
