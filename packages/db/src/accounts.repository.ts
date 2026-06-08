/**
 * Account reads (see spec 0001). Account CRUD is out of scope this phase; the HTTP
 * layer only needs an existence/lookup check to 404 unknown accounts before
 * ingesting or listing. Kept separate from `repository.ts` so that file stays
 * focused on statements/transactions.
 */
import { asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { accounts } from "./schema.js";

/** Fetch an account by id, or `null` when it does not exist. */
export async function getAccountById(db: Database, id: string) {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return rows[0] ?? null;
}

/** List all accounts, ordered by name for a stable, deterministic result. */
export async function listAccounts(db: Database) {
  return db.select().from(accounts).orderBy(asc(accounts.name));
}
