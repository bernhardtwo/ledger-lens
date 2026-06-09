import { describe, expect, it } from "vitest";
import {
  type CaseEvaluation,
  buildReport,
  primaryGatePass,
  renderMarkdown,
  summarizeModel,
} from "./report.js";

function evaluation(overrides: Partial<CaseEvaluation> = {}): CaseEvaluation {
  return {
    caseId: "c",
    question: "q",
    actualTools: ["summarize_account"],
    answerText: "a",
    turns: 2,
    costUsd: 0.01,
    toolSelection: { pass: true, missing: [], extra: [] },
    answer: { pass: true, kind: "figure", detail: "found" },
    faithfulness: { pass: true, offenders: [] },
    scope: { pass: true, violations: [] },
    judge: null,
    ...overrides,
  };
}

describe("summarizeModel", () => {
  it("computes per-metric rates, judge average and the gate verdict", () => {
    const cases = [
      evaluation({ caseId: "ok", judge: { score: 4, rationale: "" }, turns: 3, costUsd: 0.02 }),
      evaluation({
        caseId: "bad-tools",
        toolSelection: { pass: false, missing: ["summarize_account"], extra: [] },
        turns: 1,
        costUsd: 0.04,
      }),
    ];
    const report = summarizeModel("claude-haiku-4-5", cases);
    expect(report.totals.toolSelectionRate).toBe(0.5);
    expect(report.totals.answerRate).toBe(1);
    expect(report.totals.judgeAvg).toBe(4);
    expect(report.totals.costUsd).toBeCloseTo(0.06);
    expect(report.totals.avgTurns).toBe(2);
    // tool-selection 0.5 < 0.9 → gate fails.
    expect(report.gate.pass).toBe(false);
  });

  it("passes the gate when both gating rates clear the threshold", () => {
    const report = summarizeModel("m", [evaluation(), evaluation({ caseId: "c2" })]);
    expect(report.gate.pass).toBe(true);
    expect(report.totals.judgeAvg).toBeNull();
  });
});

describe("buildReport / primaryGatePass", () => {
  it("gates on the primary (first) model only", () => {
    const report = buildReport("2026-06-08T00:00:00.000Z", [
      { model: "primary", cases: [evaluation()] },
      {
        model: "weak",
        cases: [
          evaluation({ toolSelection: { pass: false, missing: ["summarize_account"], extra: [] } }),
        ],
      },
    ]);
    expect(report.models).toHaveLength(2);
    expect(primaryGatePass(report)).toBe(true);
  });

  it("fails closed on an empty report", () => {
    expect(primaryGatePass(buildReport("t", []))).toBe(false);
  });
});

describe("renderMarkdown", () => {
  it("renders a summary table and per-model case tables", () => {
    const md = renderMarkdown(
      buildReport("2026-06-08T00:00:00.000Z", [
        {
          model: "claude-haiku-4-5",
          cases: [
            evaluation({
              toolSelection: { pass: false, missing: ["summarize_account"], extra: [] },
            }),
          ],
        },
      ]),
    );
    expect(md).toContain("# LedgerLens eval report");
    expect(md).toContain("## Summary");
    expect(md).toContain("claude-haiku-4-5");
    expect(md).toContain("FAIL");
  });
});
