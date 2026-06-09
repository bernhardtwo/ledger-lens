/**
 * The eval runner (`pnpm eval`) — see ADR-0009 / spec 0005. The **only** eval path
 * that calls the real Claude API + MCP tools, like the smoke; a `.ts` (not
 * `.test.ts`/`.itest.ts`), so no vitest run picks it up, and it is never part of
 * `pnpm check` / `pnpm test` / `test:integration`.
 *
 * It migrates + seeds a real Postgres (`DATABASE_URL`), runs the committed golden
 * dataset through the real agent for each `--model`, scores deterministically
 * (+ optional `--judge`), writes `report.json` / `report.md`, and exits non-zero
 * if the **primary** model misses the gate.
 *
 * Usage (needs DATABASE_URL + ANTHROPIC_API_KEY in the environment):
 *   pnpm eval
 *   pnpm eval -- --models claude-haiku-4-5,claude-sonnet-4-6 --judge --out ./reports
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyMigrations, createDatabase, seedDemo } from "@ledger-lens/db";
import {
  type CaseEvaluation,
  DEFAULT_THRESHOLDS,
  type EvalCase,
  type EvalReport,
  buildJudgePrompt,
  buildReport,
  loadDataset,
  primaryGatePass,
  renderMarkdown,
  scoreAnswer,
  scoreFaithfulness,
  scoreScope,
  scoreToolSelection,
} from "@ledger-lens/evals";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_TURNS,
} from "../agent/agent-sdk-client.js";
import { AgentSdkRunner } from "./agent-runner.js";
import { collectAllowedFigures } from "./faithfulness.js";
import { JudgeClient } from "./judge-client.js";

interface ParsedArgs {
  readonly models: string[] | null;
  readonly judge: boolean;
  readonly judgeModel: string | null;
  readonly out: string | null;
}

function parseArgs(tokens: readonly string[]): ParsedArgs {
  let models: string[] | null = null;
  let judge = false;
  let judgeModel: string | null = null;
  let out: string | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
    const readValue = (): string | undefined => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      index += 1;
      return tokens[index];
    };

    switch (flag) {
      case "--models":
        models = (readValue() ?? "")
          .split(",")
          .map((model) => model.trim())
          .filter((model) => model.length > 0);
        break;
      case "--judge":
        judge = true;
        break;
      case "--judge-model":
        judgeModel = readValue() ?? null;
        break;
      case "--out":
        out = readValue() ?? null;
        break;
      default:
        break;
    }
  }
  return { models, judge, judgeModel, out };
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function evaluateCase(
  db: ReturnType<typeof createDatabase>["db"],
  runner: AgentSdkRunner,
  judge: JudgeClient | null,
  evalCase: EvalCase,
): Promise<CaseEvaluation> {
  const run = await runner.run({ accountId: evalCase.accountId, question: evalCase.question });
  const allowedFigures = await collectAllowedFigures(db, run.toolCalls, evalCase.accountId);
  const actualTools = run.toolCalls.map((call) => call.tool);

  let judgeVerdict: CaseEvaluation["judge"] = null;
  if (judge !== null) {
    try {
      judgeVerdict = await judge.judge(
        buildJudgePrompt({
          question: evalCase.question,
          answer: run.answer,
          groundTruth: evalCase.groundTruth,
        }),
      );
    } catch {
      judgeVerdict = null; // the judge is reported-only — a failure never blocks a run.
    }
  }

  return {
    caseId: evalCase.id,
    question: evalCase.question,
    actualTools,
    answerText: run.answer,
    turns: run.turns,
    costUsd: run.costUsd,
    toolSelection: scoreToolSelection(actualTools, evalCase.expectedTools),
    answer: scoreAnswer(run.answer, evalCase.groundTruth, allowedFigures),
    faithfulness: scoreFaithfulness(run.answer, allowedFigures, evalCase.groundTruth),
    scope: scoreScope(run.toolCalls, evalCase.accountId),
    judge: judgeVerdict,
  };
}

async function writeReports(report: EvalReport, outArg: string | null): Promise<string> {
  const outDir = outArg
    ? resolve(outArg)
    : fileURLToPath(new URL("../../../../packages/evals/reports", import.meta.url));
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "report.md"), renderMarkdown(report), "utf8");
  return outDir;
}

function gateMark(evaluation: CaseEvaluation): string {
  return evaluation.toolSelection.pass && evaluation.answer.pass ? "ok  " : "FAIL";
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is required to run evals");
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("ANTHROPIC_API_KEY is required to run evals");
  }

  const args = parseArgs(argv.slice(2));
  const models = args.models ?? [process.env.ANTHROPIC_AGENT_MODEL ?? DEFAULT_AGENT_MODEL];
  if (models.length === 0) {
    throw new Error("no models to evaluate (check --models)");
  }
  const maxTurns = numberFromEnv("ANTHROPIC_AGENT_MAX_TURNS", DEFAULT_MAX_TURNS);
  const maxBudgetUsd = numberFromEnv("ANTHROPIC_AGENT_MAX_BUDGET_USD", DEFAULT_MAX_BUDGET_USD);
  const judge = args.judge ? new JudgeClient(apiKey, args.judgeModel ?? DEFAULT_AGENT_MODEL) : null;

  const { db, client } = createDatabase(databaseUrl);
  try {
    await applyMigrations(db);
    await seedDemo(db);
    const cases = loadDataset();

    const perModel: Array<{ model: string; cases: CaseEvaluation[] }> = [];
    for (const model of models) {
      stdout.write(`\nRunning ${cases.length} cases on ${model}${judge ? " (with judge)" : ""}\n`);
      const runner = new AgentSdkRunner({ model, maxTurns, maxBudgetUsd });
      const evaluations: CaseEvaluation[] = [];
      for (const evalCase of cases) {
        const evaluation = await evaluateCase(db, runner, judge, evalCase);
        evaluations.push(evaluation);
        stdout.write(`  ${gateMark(evaluation)}  ${evalCase.id}\n`);
      }
      perModel.push({ model, cases: evaluations });
    }

    const report = buildReport(new Date().toISOString(), perModel, DEFAULT_THRESHOLDS);
    const outDir = await writeReports(report, args.out);

    stdout.write("\n");
    for (const modelReport of report.models) {
      const t = modelReport.totals;
      stdout.write(
        `${modelReport.model}: tool-selection ${(t.toolSelectionRate * 100).toFixed(0)}% | ` +
          `answer ${(t.answerRate * 100).toFixed(0)}% | faithful ${(t.faithfulnessRate * 100).toFixed(0)}% | ` +
          `scope ${(t.scopeRate * 100).toFixed(0)}% | cost $${t.costUsd.toFixed(4)} | ` +
          `gate ${modelReport.gate.pass ? "PASS" : "FAIL"}\n`,
      );
    }
    stdout.write(`\nReport written to ${outDir}\n`);

    process.exitCode = primaryGatePass(report) ? 0 : 1;
  } finally {
    await client.end();
  }
}

const entry = argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main().catch((error: unknown) => {
    stdout.write(`eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
