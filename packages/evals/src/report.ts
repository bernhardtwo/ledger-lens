/**
 * Report builders (see ADR-0009 §10, spec 0005). Pure aggregation + rendering:
 * per-case results → per-model totals → a JSON report and a human Markdown summary
 * (with a multi-model comparison table). Unit-tested with synthetic case results;
 * the runner in `apps/api` feeds it real results and writes the files.
 */
import type { JudgeVerdict } from "./judge.js";
import type {
  AnswerResult,
  FaithfulnessResult,
  ScopeResult,
  ToolSelectionResult,
} from "./scoring.js";

/** The full evaluation of one case against one model. */
export interface CaseEvaluation {
  readonly caseId: string;
  readonly question: string;
  readonly actualTools: readonly string[];
  readonly answerText: string;
  readonly turns: number;
  readonly costUsd: number;
  readonly toolSelection: ToolSelectionResult;
  readonly answer: AnswerResult;
  readonly faithfulness: FaithfulnessResult;
  readonly scope: ScopeResult;
  /** Null when `--judge` was off or the judge call failed. */
  readonly judge: JudgeVerdict | null;
}

/** The gating thresholds the report is scored against. */
export interface GateThresholds {
  readonly toolSelection: number;
  readonly answer: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = { toolSelection: 0.9, answer: 0.9 };

export interface ModelTotals {
  readonly cases: number;
  readonly toolSelectionRate: number;
  readonly answerRate: number;
  readonly faithfulnessRate: number;
  readonly scopeRate: number;
  /** Mean judge score over judged cases, or null when none were judged. */
  readonly judgeAvg: number | null;
  readonly costUsd: number;
  readonly avgTurns: number;
}

export interface ModelReport {
  readonly model: string;
  readonly totals: ModelTotals;
  readonly gate: { readonly pass: boolean; readonly thresholds: GateThresholds };
  readonly cases: readonly CaseEvaluation[];
}

export interface EvalReport {
  readonly generatedAt: string;
  readonly thresholds: GateThresholds;
  readonly models: readonly ModelReport[];
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Aggregate one model's per-case results into a `ModelReport` (with its gate verdict). */
export function summarizeModel(
  model: string,
  cases: readonly CaseEvaluation[],
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): ModelReport {
  const total = cases.length;
  const judged = cases.flatMap((c) => (c.judge === null ? [] : [c.judge.score]));
  const totals: ModelTotals = {
    cases: total,
    toolSelectionRate: ratio(cases.filter((c) => c.toolSelection.pass).length, total),
    answerRate: ratio(cases.filter((c) => c.answer.pass).length, total),
    faithfulnessRate: ratio(cases.filter((c) => c.faithfulness.pass).length, total),
    scopeRate: ratio(cases.filter((c) => c.scope.pass).length, total),
    judgeAvg: judged.length === 0 ? null : mean(judged),
    costUsd: cases.reduce((sum, c) => sum + c.costUsd, 0),
    avgTurns: mean(cases.map((c) => c.turns)),
  };
  const gatePass =
    totals.toolSelectionRate >= thresholds.toolSelection && totals.answerRate >= thresholds.answer;
  return { model, totals, gate: { pass: gatePass, thresholds }, cases };
}

/** Assemble the full report from each model's results. */
export function buildReport(
  generatedAt: string,
  perModel: ReadonlyArray<{ readonly model: string; readonly cases: readonly CaseEvaluation[] }>,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): EvalReport {
  return {
    generatedAt,
    thresholds,
    models: perModel.map((entry) => summarizeModel(entry.model, entry.cases, thresholds)),
  };
}

/**
 * The gate verdict for the **primary** model (the first one, which CI runs by
 * default). Additional `--models` are comparison-only and never fail the gate.
 * An empty report fails closed.
 */
export function primaryGatePass(report: EvalReport): boolean {
  return report.models[0]?.gate.pass ?? false;
}

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;
const check = (pass: boolean): string => (pass ? "✅" : "❌");
const judgeCell = (value: number | null): string => (value === null ? "—" : value.toFixed(1));

function summaryTable(models: readonly ModelReport[]): string {
  const header =
    "| Model | Tool sel | Answer | Faithful | Scope | Judge | Cost (USD) | Turns | Gate |\n" +
    "|---|---|---|---|---|---|---|---|---|";
  const rows = models.map((report) => {
    const t = report.totals;
    return `| ${report.model} | ${pct(t.toolSelectionRate)} | ${pct(t.answerRate)} | ${pct(
      t.faithfulnessRate,
    )} | ${pct(t.scopeRate)} | ${judgeCell(t.judgeAvg)} | ${t.costUsd.toFixed(4)} | ${t.avgTurns.toFixed(
      1,
    )} | ${report.gate.pass ? "PASS" : "FAIL"} |`;
  });
  return [header, ...rows].join("\n");
}

function caseTable(report: ModelReport): string {
  const header =
    "| Case | Tools | Answer | Faithful | Scope | Judge | Detail |\n|---|---|---|---|---|---|---|";
  const rows = report.cases.map((c) => {
    const tools = c.actualTools.length === 0 ? "(none)" : c.actualTools.join(", ");
    const judge = c.judge === null ? "—" : String(c.judge.score);
    return `| ${c.caseId} | ${check(c.toolSelection.pass)} ${tools} | ${check(c.answer.pass)} | ${check(
      c.faithfulness.pass,
    )} | ${check(c.scope.pass)} | ${judge} | ${c.answer.detail} |`;
  });
  return [header, ...rows].join("\n");
}

/** Render the report as Markdown: a comparison summary plus per-model case tables. */
export function renderMarkdown(report: EvalReport): string {
  const sections: string[] = [
    "# LedgerLens eval report",
    "",
    `Generated: ${report.generatedAt}`,
    `Gate thresholds: tool-selection ≥ ${pct(report.thresholds.toolSelection)}, answer ≥ ${pct(
      report.thresholds.answer,
    )} (primary model only)`,
    "",
    "## Summary",
    "",
    summaryTable(report.models),
  ];
  for (const model of report.models) {
    sections.push("", `## ${model.model} — cases`, "", caseTable(model));
  }
  return `${sections.join("\n")}\n`;
}
