/**
 * Migration runner (see spec 0001). Applies the drizzle-kit-generated SQL in
 * `packages/db/drizzle/` to a database. Used both by the integration tests (against
 * a disposable Postgres) and by the `db:migrate` dev script.
 */
import { dirname, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { type Database, createDatabase } from "./client.js";

/** Folder holding the generated migration SQL (`packages/db/drizzle`). */
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

/** Apply all pending migrations to the given database. */
export async function applyMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** CLI entry: migrate the database at `DATABASE_URL`, then close the pool. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  const { db, client } = createDatabase(url);
  try {
    await applyMigrations(db);
  } finally {
    await client.end();
  }
}

const entry = argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
