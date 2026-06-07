import { Module } from "@nestjs/common";
/**
 * Provides the Drizzle database handle (token {@link DATABASE}) from
 * `DATABASE_URL` (server-side only). Integration/e2e tests override the token with
 * a handle bound to a disposable Postgres container, so this factory never runs
 * there.
 */
import { type Database, createDatabase } from "../../db/client.js";
import { DATABASE } from "./database.tokens.js";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required (server-side only)");
  }
  return url;
}

@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Database => createDatabase(databaseUrl()).db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
