import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CurrencyCode } from "@ledger-lens/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CategorizationClient } from "../../categorization/types.js";
import { type Database, type DatabaseConnection, createDatabase } from "../../db/client.js";
import { applyMigrations } from "../../db/migrate.js";
import { accounts } from "../../db/schema.js";
import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.tokens.js";
import { CATEGORIZATION_CLIENT } from "./categorization.tokens.js";

function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`../../ingestion/__fixtures__/${name}`, import.meta.url)),
  );
}

// Deterministic, network-free mock. Known descriptions -> a real category; anything
// else -> an off-taxonomy label, so the core's uncategorized fallback is exercised
// end-to-end. No suite ever calls the real API.
const DESCRIPTION_CATEGORY: Record<string, string> = {
  "COFFEE BAR #12": "dining",
  "ACME PAYROLL": "income",
};

type CategorizeFn = CategorizationClient["categorize"];

const defaultCategorize: CategorizeFn = async (items) => ({
  categorizations: items.map((item) => ({
    index: item.index,
    category: DESCRIPTION_CATEGORY[item.description] ?? "definitely-not-a-category",
  })),
});

// Swappable so a single test can simulate a transport failure, then restore.
let categorizeImpl: CategorizeFn = defaultCategorize;
const mockClient: CategorizationClient = {
  modelId: "mock-haiku",
  categorize: (items) => categorizeImpl(items),
};

let container: StartedPostgreSqlContainer;
let connection: DatabaseConnection;
let db: Database;
let app: INestApplication;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  connection = createDatabase(container.getConnectionUri());
  db = connection.db;
  await applyMigrations(db);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(CATEGORIZATION_CLIENT)
    .useValue(mockClient)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await connection?.client.end();
  await container?.stop();
});

async function freshAccount(currency: CurrencyCode = "USD"): Promise<string> {
  const id = randomUUID();
  await db.insert(accounts).values({
    id,
    name: "Categorize Account",
    institution: "Test Bank",
    currencyCode: currency,
    kind: "bank",
  });
  return id;
}

function http() {
  return request(app.getHttpServer());
}

async function ingest(accountId: string, file: string): Promise<void> {
  await http()
    .post(`/accounts/${accountId}/statements`)
    .attach("file", fixture(file), { filename: file, contentType: "text/csv" });
}

describe("POST /accounts/:accountId/categorize", () => {
  it("categorizes uncategorized transactions and exposes the category via GET", async () => {
    const accountId = await freshAccount("USD");
    await ingest(accountId, "bank-a.csv");

    const res = await http().post(`/accounts/${accountId}/categorize`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalUncategorized: 2,
      categorized: 2,
      uncategorized: 0,
      failed: 0,
    });

    const list = await http().get(`/accounts/${accountId}/transactions`).query({ limit: 10 });
    const byDescription = new Map<string, string | null>(
      list.body.items.map((item: { description: string; category: string | null }) => [
        item.description,
        item.category,
      ]),
    );
    expect(byDescription.get("COFFEE BAR #12")).toBe("dining");
    expect(byDescription.get("ACME PAYROLL")).toBe("income");
  });

  it("re-categorizing is a no-op (skips already-categorized rows)", async () => {
    const accountId = await freshAccount("USD");
    await ingest(accountId, "bank-a.csv");
    await http().post(`/accounts/${accountId}/categorize`);

    const second = await http().post(`/accounts/${accountId}/categorize`);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      totalUncategorized: 0,
      categorized: 0,
      uncategorized: 0,
      failed: 0,
    });
  });

  it("falls back to uncategorized for an off-taxonomy model answer", async () => {
    const accountId = await freshAccount("USD");
    await ingest(accountId, "bank-a-extra.csv"); // adds BOOKSTORE (not in the mock map)

    const res = await http().post(`/accounts/${accountId}/categorize`);
    expect(res.body.categorized).toBe(2); // COFFEE -> dining, ACME -> income
    expect(res.body.uncategorized).toBe(1); // BOOKSTORE -> off-taxonomy -> uncategorized

    const list = await http().get(`/accounts/${accountId}/transactions`).query({ limit: 10 });
    const bookstore = list.body.items.find(
      (item: { description: string }) => item.description === "BOOKSTORE",
    );
    expect(bookstore?.category).toBe("uncategorized");
  });

  it("leaves rows NULL on a transport failure and is resumable", async () => {
    const accountId = await freshAccount("USD");
    await ingest(accountId, "bank-a.csv");

    categorizeImpl = async () => {
      throw new Error("transport down");
    };
    try {
      const failed = await http().post(`/accounts/${accountId}/categorize`);
      expect(failed.status).toBe(200);
      expect(failed.body).toEqual({
        totalUncategorized: 2,
        categorized: 0,
        uncategorized: 0,
        failed: 2,
      });

      // The failed batch left every row uncategorized (NULL) — nothing persisted.
      const afterFail = await http()
        .get(`/accounts/${accountId}/transactions`)
        .query({ limit: 10 });
      for (const item of afterFail.body.items as { category: string | null }[]) {
        expect(item.category).toBeNull();
      }
    } finally {
      categorizeImpl = defaultCategorize;
    }

    // Resumable: a subsequent working run categorizes the same rows.
    const resumed = await http().post(`/accounts/${accountId}/categorize`);
    expect(resumed.body).toEqual({
      totalUncategorized: 2,
      categorized: 2,
      uncategorized: 0,
      failed: 0,
    });
    const afterOk = await http().get(`/accounts/${accountId}/transactions`).query({ limit: 10 });
    const coffee = afterOk.body.items.find(
      (item: { description: string }) => item.description === "COFFEE BAR #12",
    );
    expect(coffee?.category).toBe("dining");
  });

  it("404s an unknown account", async () => {
    const res = await http().post(`/accounts/${randomUUID()}/categorize`);
    expect(res.status).toBe(404);
  });
});
