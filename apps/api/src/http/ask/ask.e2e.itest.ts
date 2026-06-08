/**
 * Full-loop integration test for `POST /accounts/:accountId/ask` (see spec 0004,
 * ADR-0008). The agent's *decisions* are scripted, but everything below is real:
 * the scripted double drives a real `@modelcontextprotocol/sdk` client → the real
 * `packages/mcp-server` over stdio → real tools → a testcontainers Postgres. Its
 * phrasing is a pure function of the **real** tool results, so the asserted
 * numbers prove the loop executed end-to-end. No real Claude API anywhere.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  type Database,
  type DatabaseConnection,
  accounts,
  applyCategorizations,
  applyMigrations,
  createDatabase,
  listTransactions,
  persistIngestion,
} from "@ledger-lens/db";
import {
  type Category,
  type Direction,
  type Money,
  type TransactionDraft,
  isoDate,
  money,
} from "@ledger-lens/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mcpServerLaunch } from "../../agent/mcp-launch.js";
import { STEP_LIMIT_MESSAGE } from "../../agent/query.js";
import { resolveToolCall, stripPrefix } from "../../agent/scope.js";
import type { QaAgent, QaAnswer, ToolCall } from "../../agent/types.js";
import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.tokens.js";
import { QA_AGENT } from "./ask.tokens.js";

interface Decision {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

/**
 * Test double of the `QaAgent` port: canned decisions, but the tools execute for
 * real over the MCP protocol. It mirrors production by routing each decision
 * through `resolveToolCall` — the SAME guard the adapter wires into `canUseTool` —
 * and calling the tool with the returned `updatedInput` (the scoped accountId
 * injected). So a denied call never reaches the DB, and a mis-passed accountId is
 * overwritten before the tool runs. (The SDK's own runtime validation of the
 * permission result is exercised only by the smoke; here we exercise the guard +
 * injection + the real tool/DB.)
 */
class ScriptedQaAgent implements QaAgent {
  decisions: Decision[] = [];
  phrase: (results: unknown[]) => string = () => "(no answer scripted)";

  constructor(
    private readonly client: Client,
    private readonly maxToolCalls: number,
  ) {}

  async ask({ accountId }: { accountId: string; question: string }): Promise<QaAnswer> {
    const toolCalls: ToolCall[] = [];
    const results: unknown[] = [];
    for (const decision of this.decisions) {
      if (toolCalls.length >= this.maxToolCalls) {
        return {
          answer: STEP_LIMIT_MESSAGE,
          toolCalls,
          model: "scripted",
          turns: toolCalls.length,
        };
      }
      const scope = resolveToolCall(accountId, decision.tool, decision.input);
      if (!scope.allowed) {
        continue; // denied (list_accounts / unknown) -> never reaches the MCP server / DB
      }
      // Run with the INJECTED input (scoped accountId forced in), as production does.
      const res = await this.client.callTool({
        name: decision.tool,
        arguments: scope.updatedInput,
      });
      results.push((res as { structuredContent?: unknown }).structuredContent);
      toolCalls.push({ tool: stripPrefix(decision.tool), input: scope.updatedInput });
    }
    return { answer: this.phrase(results), toolCalls, model: "scripted", turns: toolCalls.length };
  }
}

interface Fixture {
  readonly description: string;
  readonly direction: Direction;
  readonly amountMinor: bigint;
  readonly category: Category;
}

// Primary account: debits 3000+500+1500+2000 = 7000 out, 250000 in -> net credit 243000.
const FIXTURES: readonly Fixture[] = [
  { description: "WHOLE FOODS", direction: "debit", amountMinor: 3000n, category: "groceries" },
  { description: "COFFEE BAR", direction: "debit", amountMinor: 500n, category: "dining" },
  { description: "RESTAURANT", direction: "debit", amountMinor: 1500n, category: "dining" },
  { description: "ACME PAYROLL", direction: "credit", amountMinor: 250000n, category: "income" },
  { description: "ELECTRONICS", direction: "debit", amountMinor: 2000n, category: "shopping" },
];

// A second account with distinct data — if scoping ever leaked, its numbers would show.
const OTHER_FIXTURES: readonly Fixture[] = [
  { description: "OTHER PAYROLL", direction: "credit", amountMinor: 999999n, category: "income" },
];

const MAX_TOOL_CALLS = 3;

let container: StartedPostgreSqlContainer;
let connection: DatabaseConnection;
let db: Database;
let app: INestApplication;
let client: Client;
let scripted: ScriptedQaAgent;
let accountId: string;
let otherAccountId: string;

function toDraft(account: string, fixture: Fixture, index: number): TransactionDraft {
  const amount: Money = money(fixture.amountMinor, "USD");
  return {
    accountId: account,
    transactionDate: isoDate("2026-05-01"),
    postedDate: null,
    description: fixture.description,
    direction: fixture.direction,
    amount,
    fingerprint: `${account}-${index}`,
    rawRow: { Description: fixture.description },
  };
}

async function freshAccount(name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(accounts).values({
    id,
    name,
    institution: "Test Bank",
    currencyCode: "USD",
    kind: "bank",
  });
  return id;
}

async function seed(account: string, fixtures: readonly Fixture[]): Promise<void> {
  await persistIngestion(db, {
    accountId: account,
    sourceFilename: "fixtures.csv",
    profileId: "bank-a@v1",
    accepted: fixtures.map((fixture, index) => toDraft(account, fixture, index)),
  });
  const byDescription = new Map(fixtures.map((f) => [f.description, f.category]));
  const persisted = await listTransactions(db, { accountId: account, limit: 200 });
  await applyCategorizations(
    db,
    persisted.items.map((item) => ({
      id: item.id,
      category: byDescription.get(item.description) ?? "uncategorized",
    })),
    "test",
    new Date(),
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  connection = createDatabase(container.getConnectionUri());
  db = connection.db;
  await applyMigrations(db);

  accountId = await freshAccount("Primary");
  otherAccountId = await freshAccount("Other");
  await seed(accountId, FIXTURES);
  await seed(otherAccountId, OTHER_FIXTURES);

  // Real MCP client over stdio to the real server, pointed at the container.
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }
  childEnv.DATABASE_URL = container.getConnectionUri();
  const launch = mcpServerLaunch();
  const transport = new StdioClientTransport({
    command: launch.command,
    args: [...launch.args],
    env: childEnv,
  });
  client = new Client({ name: "ask-itest", version: "0.0.0" });
  await client.connect(transport);

  scripted = new ScriptedQaAgent(client, MAX_TOOL_CALLS);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(QA_AGENT)
    .useValue(scripted)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  await connection?.client.end();
  await container?.stop();
});

beforeEach(() => {
  scripted.decisions = [];
  scripted.phrase = () => "(no answer scripted)";
});

function http() {
  return request(app.getHttpServer());
}

describe("POST /accounts/:accountId/ask", () => {
  it("answers from a real summarize_account call over the MCP protocol", async () => {
    scripted.decisions = [{ tool: "summarize_account", input: { accountId } }];
    scripted.phrase = (results) => {
      const net = (results[0] as { net: { direction: string; amount: { amount: string } } }).net;
      return `net is ${net.direction} ${net.amount.amount}`;
    };

    const res = await http()
      .post(`/accounts/${accountId}/ask`)
      .send({ question: "What is my net?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("net is credit 243000"); // 250000 in - 7000 out, via the real fold
    expect(res.body.toolCalls).toEqual([{ tool: "summarize_account", input: { accountId } }]);
    expect(res.body.meta).toEqual({ model: "scripted", turns: 1 });
  });

  // Regression for the smoke-caught bug: the agent mis-passing/omitting accountId
  // must NOT escape scope. Injection overwrites it, so the tool runs against the
  // scoped account regardless. The other account really has net credit 999999, so
  // asserting 243000 proves the foreign id was overridden (not just "denied").
  it("redirects a foreign or omitted accountId to the scoped account (injection)", async () => {
    const netPhrase = (results: unknown[]) => {
      const net = (results[0] as { net: { direction: string; amount: { amount: string } } }).net;
      return `net is ${net.direction} ${net.amount.amount}`;
    };

    // The agent asks for ANOTHER account (whose real net is credit 999999)...
    scripted.decisions = [{ tool: "summarize_account", input: { accountId: otherAccountId } }];
    scripted.phrase = netPhrase;
    let res = await http()
      .post(`/accounts/${accountId}/ask`)
      .send({ question: "summarize the other account" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("net is credit 243000"); // ...but it got THIS account
    expect(res.body.toolCalls).toEqual([{ tool: "summarize_account", input: { accountId } }]);

    // Same when the agent omits accountId entirely — injection supplies it.
    scripted.decisions = [{ tool: "summarize_account", input: {} }];
    scripted.phrase = netPhrase;
    res = await http().post(`/accounts/${accountId}/ask`).send({ question: "what's my net?" });
    expect(res.body.answer).toBe("net is credit 243000");
    expect(res.body.toolCalls).toEqual([{ tool: "summarize_account", input: { accountId } }]);
  });

  it("denies list_accounts", async () => {
    scripted.decisions = [{ tool: "list_accounts", input: {} }];
    scripted.phrase = (results) => `calls=${results.length}`;

    const res = await http()
      .post(`/accounts/${accountId}/ask`)
      .send({ question: "list every account" });

    expect(res.status).toBe(200);
    expect(res.body.toolCalls).toEqual([]);
  });

  it("returns 200 with an honest answer when no tool is called", async () => {
    scripted.decisions = [];
    scripted.phrase = () => "I don't have that information.";

    const res = await http()
      .post(`/accounts/${accountId}/ask`)
      .send({ question: "what's the weather?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("I don't have that information.");
    expect(res.body.toolCalls).toEqual([]);
  });

  it("returns a graceful 200 when the tool-call cap is exceeded", async () => {
    scripted.decisions = Array.from({ length: MAX_TOOL_CALLS + 1 }, () => ({
      tool: "summarize_account",
      input: { accountId },
    }));
    scripted.phrase = () => "should not be reached";

    const res = await http().post(`/accounts/${accountId}/ask`).send({ question: "loop please" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(STEP_LIMIT_MESSAGE);
    expect(res.body.toolCalls).toHaveLength(MAX_TOOL_CALLS);
  });

  it("404s an unknown account before invoking the agent", async () => {
    const res = await http().post(`/accounts/${randomUUID()}/ask`).send({ question: "hi" });
    expect(res.status).toBe(404);
  });

  it("400s an empty question", async () => {
    const res = await http().post(`/accounts/${accountId}/ask`).send({ question: "" });
    expect(res.status).toBe(400);
  });

  it("400s a non-uuid account", async () => {
    const res = await http().post("/accounts/not-a-uuid/ask").send({ question: "hi" });
    expect(res.status).toBe(400);
  });
});
