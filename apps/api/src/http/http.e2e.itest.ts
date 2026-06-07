import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Database,
  type DatabaseConnection,
  accounts,
  applyMigrations,
  createDatabase,
  seedAccounts,
} from "@ledger-lens/db";
import type { CurrencyCode } from "@ledger-lens/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { DATABASE } from "./database/database.tokens.js";

function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../ingestion/__fixtures__/${name}`, import.meta.url)));
}

let container: StartedPostgreSqlContainer;
let connection: DatabaseConnection;
let db: Database;
let app: INestApplication;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  connection = createDatabase(container.getConnectionUri());
  db = connection.db;
  await applyMigrations(db);
  await seedAccounts(db);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await connection?.client.end();
  await container?.stop();
});

/** Insert a throwaway account so each test is isolated by account id. */
async function freshAccount(currency: CurrencyCode = "USD"): Promise<string> {
  const id = randomUUID();
  await db.insert(accounts).values({
    id,
    name: "E2E Account",
    institution: "E2E Bank",
    currencyCode: currency,
    kind: "bank",
  });
  return id;
}

function http() {
  return request(app.getHttpServer());
}

describe("POST /accounts/:accountId/statements", () => {
  it("ingests a valid CSV → 201 with inserted/skipped/rejected", async () => {
    const accountId = await freshAccount("USD");
    const res = await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", fixture("bank-a.csv"), { filename: "bank-a.csv", contentType: "text/csv" });

    expect(res.status).toBe(201);
    expect(res.body.profileId).toBe("bank-a@v1");
    expect(res.body.inserted).toBe(2);
    expect(res.body.skipped).toBe(0);
    expect(res.body.rejected).toEqual([]);
    expect(res.body.statementId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is idempotent on a re-import → 200, 0 inserted, null statementId", async () => {
    const accountId = await freshAccount("USD");
    const upload = () =>
      http()
        .post(`/accounts/${accountId}/statements`)
        .attach("file", fixture("bank-a.csv"), { filename: "bank-a.csv", contentType: "text/csv" });

    const first = await upload();
    expect(first.status).toBe(201);
    expect(first.body.inserted).toBe(2);

    const second = await upload();
    expect(second.status).toBe(200);
    expect(second.body.inserted).toBe(0);
    expect(second.body.skipped).toBe(2);
    expect(second.body.statementId).toBeNull();
  });

  it("persists only the new rows on a partial re-import → 201, inserted 1, skipped 2", async () => {
    const accountId = await freshAccount("USD");
    await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", fixture("bank-a.csv"), { filename: "bank-a.csv", contentType: "text/csv" });

    const res = await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", fixture("bank-a-extra.csv"), {
        filename: "bank-a-extra.csv",
        contentType: "text/csv",
      });
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(1);
    expect(res.body.skipped).toBe(2);
    expect(res.body.statementId).not.toBeNull();
  });

  it("rejects a file whose currency does not match the account → 422", async () => {
    const usdAccount = await freshAccount("USD");
    const res = await http()
      .post(`/accounts/${usdAccount}/statements`)
      .attach("file", fixture("banco-b.csv"), {
        filename: "banco-b.csv",
        contentType: "text/csv",
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("currency-mismatch");
  });

  it("maps unknown headers → 422 unknown-profile (with signature)", async () => {
    const accountId = await freshAccount("USD");
    const res = await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", fixture("unknown-headers.csv"), {
        filename: "unknown.csv",
        contentType: "text/csv",
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("unknown-profile");
    expect(res.body.signature).toBe("bar|baz|foo");
  });

  it("maps a mostly-garbage file → 422 too-many-rejected", async () => {
    const accountId = await freshAccount("USD");
    const res = await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", fixture("garbage.csv"), { filename: "garbage.csv", contentType: "text/csv" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("too-many-rejected");
  });

  it("maps an empty file → 400 empty-file", async () => {
    const accountId = await freshAccount("USD");
    const res = await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", Buffer.from(""), { filename: "empty.csv", contentType: "text/csv" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("empty-file");
  });

  it("rejects a non-CSV content type → 415", async () => {
    const accountId = await freshAccount("USD");
    const res = await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: "logo.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(415);
  });

  it("rejects an oversized file → 413", async () => {
    const accountId = await freshAccount("USD");
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
    const res = await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", tooBig, { filename: "big.csv", contentType: "text/csv" });
    expect(res.status).toBe(413);
  });

  it("requires a file → 400", async () => {
    const accountId = await freshAccount("USD");
    const res = await http().post(`/accounts/${accountId}/statements`);
    expect(res.status).toBe(400);
  });

  it("404s an unknown account", async () => {
    const res = await http()
      .post(`/accounts/${randomUUID()}/statements`)
      .attach("file", fixture("bank-a.csv"), { filename: "bank-a.csv", contentType: "text/csv" });
    expect(res.status).toBe(404);
  });
});

describe("GET /accounts/:accountId/transactions", () => {
  it("paginates in order with raw_row absent and a working cursor", async () => {
    const accountId = await freshAccount("USD");
    await http()
      .post(`/accounts/${accountId}/statements`)
      .attach("file", fixture("bank-a.csv"), { filename: "bank-a.csv", contentType: "text/csv" });

    const page1 = await http().get(`/accounts/${accountId}/transactions`).query({ limit: 1 });
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0].transactionDate).toBe("2026-05-01");
    expect(page1.body.items[0].amount).toEqual({
      amount: "500",
      currency: "USD",
      minorUnitExponent: 2,
    });
    expect("rawRow" in page1.body.items[0]).toBe(false);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await http()
      .get(`/accounts/${accountId}/transactions`)
      .query({ limit: 1, cursor: page1.body.nextCursor });
    expect(page2.status).toBe(200);
    expect(page2.body.items[0].transactionDate).toBe("2026-05-02");
    expect(page2.body.nextCursor).toBeNull();
  });

  it("400s a malformed cursor", async () => {
    const accountId = await freshAccount("USD");
    const res = await http()
      .get(`/accounts/${accountId}/transactions`)
      .query({ cursor: "not-a-valid-cursor" });
    expect(res.status).toBe(400);
  });

  it("400s a non-uuid accountId", async () => {
    const res = await http().get("/accounts/not-a-uuid/transactions");
    expect(res.status).toBe(400);
  });

  it("404s an unknown account", async () => {
    const res = await http().get(`/accounts/${randomUUID()}/transactions`);
    expect(res.status).toBe(404);
  });
});
