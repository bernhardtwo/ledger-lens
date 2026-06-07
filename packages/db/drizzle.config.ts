import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config (schema -> SQL migrations). `DATABASE_URL` is server-side
 * only; the fallback is the local docker-compose DB from `.env.example`, so
 * `db:generate` / `db:migrate` work against a fresh local Postgres without extra
 * env wiring. Integration tests do NOT use this config — they migrate
 * programmatically against a disposable container (see `migrate.ts`).
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://ledgerlens:ledgerlens@localhost:5432/ledgerlens",
  },
});
