/**
 * Optional LLM-as-judge for answer *quality* (see ADR-0009 §6). **Reported only,
 * never gating** — it keeps the gate cheap and deterministic. Only the prompt
 * building and the verdict parsing live here (pure, unit-tested); the actual API
 * call lives in the runner (`apps/api`), behind the `--judge` flag.
 */
import { z } from "zod";
import type { GroundTruth } from "./dataset.js";
import { renderDecimal } from "./money-match.js";

/** A judge's verdict on one answer: a 1–5 quality score plus a short rationale. */
export interface JudgeVerdict {
  readonly score: number;
  readonly rationale: string;
}

function describeGroundTruth(groundTruth: GroundTruth): string {
  switch (groundTruth.kind) {
    case "figure":
      return `The correct answer states the figure ${renderDecimal(groundTruth.money)} ${groundTruth.money.currency}.`;
    case "text":
      return `A good answer mentions: ${groundTruth.contains.join(", ")}.`;
    case "refusal":
      return "The tools cannot answer this. A good answer declines honestly and invents no figure.";
    default: {
      const exhaustive: never = groundTruth;
      throw new Error(`unhandled ground-truth kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Build the judge's system + user prompt for one (question, answer, ground truth). */
export function buildJudgePrompt(input: {
  readonly question: string;
  readonly answer: string;
  readonly groundTruth: GroundTruth;
}): { readonly system: string; readonly user: string } {
  const system = [
    "You are a strict grader for a financial assistant's answers.",
    "Score the answer from 1 (poor) to 5 (excellent) on correctness, helpfulness and clarity, given the known ground truth.",
    "An answer that states a wrong figure, or invents a figure the tools cannot provide, scores 1-2.",
    'Reply with ONLY a JSON object: {"score": <1-5 integer>, "rationale": "<one sentence>"}.',
  ].join("\n");
  const user = [
    `Question: ${input.question}`,
    `Ground truth: ${describeGroundTruth(input.groundTruth)}`,
    `Answer to grade: ${input.answer}`,
  ].join("\n");
  return { system, user };
}

const VerdictSchema = z.object({ score: z.coerce.number(), rationale: z.string().default("") });

/**
 * Parse a judge reply into a `JudgeVerdict`. Tolerant of surrounding prose: it
 * extracts the first `{…}` block, then clamps the score to an integer in 1–5.
 * Throws if no JSON object is present (the runner catches it → judge recorded null).
 */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in judge reply");
  }
  const parsed = VerdictSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  if (!Number.isFinite(parsed.score)) {
    // A non-numeric score coerces to NaN — reject it so it can't poison `judgeAvg`.
    throw new Error(`judge score is not a finite number: ${JSON.stringify(parsed.score)}`);
  }
  const score = Math.max(1, Math.min(5, Math.round(parsed.score)));
  return { score, rationale: parsed.rationale };
}
