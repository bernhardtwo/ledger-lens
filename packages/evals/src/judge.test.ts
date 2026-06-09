import { describe, expect, it } from "vitest";
import type { GroundTruth } from "./dataset.js";
import { buildJudgePrompt, parseJudgeVerdict } from "./judge.js";

describe("buildJudgePrompt", () => {
  it("asks for JSON and includes the question, answer and ground truth", () => {
    const gt: GroundTruth = {
      kind: "figure",
      money: { amount: "250402", currency: "USD", minorUnitExponent: 2 },
    };
    const { system, user } = buildJudgePrompt({
      question: "What was my net?",
      answer: "Net inflow of $2,504.02.",
      groundTruth: gt,
    });
    expect(system).toContain("JSON");
    expect(user).toContain("What was my net?");
    expect(user).toContain("Net inflow of $2,504.02.");
    expect(user).toContain("2504.02");
  });

  it("describes a refusal ground truth", () => {
    const { user } = buildJudgePrompt({
      question: "What is my credit score?",
      answer: "I can't access that.",
      groundTruth: { kind: "refusal" },
    });
    expect(user.toLowerCase()).toContain("declines");
  });
});

describe("parseJudgeVerdict", () => {
  it("parses a clean JSON verdict", () => {
    expect(parseJudgeVerdict('{"score":5,"rationale":"accurate"}')).toEqual({
      score: 5,
      rationale: "accurate",
    });
  });

  it("tolerates surrounding prose", () => {
    expect(parseJudgeVerdict('Sure! {"score": 4, "rationale": "ok"} done')).toEqual({
      score: 4,
      rationale: "ok",
    });
  });

  it("clamps the score to 1–5", () => {
    expect(parseJudgeVerdict('{"score":9,"rationale":"x"}').score).toBe(5);
    expect(parseJudgeVerdict('{"score":0,"rationale":"x"}').score).toBe(1);
  });

  it("throws when there is no JSON object", () => {
    expect(() => parseJudgeVerdict("no verdict here")).toThrow();
  });

  it("throws on a non-numeric score rather than yielding NaN", () => {
    expect(() => parseJudgeVerdict('{"score":"five","rationale":"x"}')).toThrow();
  });
});
