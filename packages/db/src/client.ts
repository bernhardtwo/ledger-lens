/**
 * Typed Drizzle client over postgres.js (see spec 0001).
 *
 * `DATABASE_URL` is **server-side only** (never imported into `apps/web`). The
 * client is created via a factory so callers control its lifecycle — the app uses
 * one long-lived instance; integration tests create a throwaway one per disposable
 * Postgres container and `client.end()` it in teardown.
 */
import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/** A Drizzle database handle bound to this project's schema. */
export type Database = PostgresJsDatabase<typeof schema>;

/** The result of {@link createDatabase}: the Drizzle handle plus the raw driver. */
export interface DatabaseConnection {
  readonly db: Database;
  /** The underlying postgres.js client — call `.end()` to close the pool. */
  readonly client: postgres.Sql;
}

/** Create a Drizzle client (and its connection pool) for a `postgres://` URL. */
export function createDatabase(url: string): DatabaseConnection {
  const client = postgres(url);
  const db = drizzle(client, { schema });
  return { db, client };
}
