/**
 * The four eval metrics (see ADR-0009 §2, spec 0005). All pure and deterministic;
 * unit-tested with mocked agent outputs.
 *
 *  - **Tool selection** (gating): every expectation satisfied by the tools called.
 *  - **Answer** (gating): figure present / text present / no fabricated figure.
 *  - **Faithfulness** (reported in v1): no money figure outside what the agent saw.
 *  - **Scope** (reported): no `list_accounts`; no foreign `accountId`.
 */
import type { GroundTruth, GroundTruthPart, ToolExpectation } from "./dataset.js";
import {
  answerContainsAmount,
  canonicalAmount,
  extractMoneyTokens,
  renderDecimal,
} from "./money-match.js";
import type { AgentToolCall } from "./runner.js";

/** The cross-account tool that must never be used by a single-account question. */
const LIST_ACCOUNTS = "list_accounts";

export interface ToolSelectionResult {
  readonly pass: boolean;
  /** Expectations not satisfied by any called tool. */
  readonly missing: readonly ToolExpectation[];
  /** Called tools that satisfied no expectation (reported; not gating). */
  readonly extra: readonly string[];
}

/**
 * Was the right tool (or an acceptable alternative) called for each expectation?
 * Containment, not equality: extra exploratory calls are reported in `extra`, not
 * failed. An empty `expectedTools` (refusal cases) trivially passes.
 */
export function scoreToolSelection(
  actualTools: readonly string[],
  expectations: readonly ToolExpectation[],
): ToolSelectionResult {
  const called = new Set(actualTools);
  const missing = expectations.filter((expectation) => {
    const alternatives = Array.isArray(expectation) ? expectation : [expectation];
    return !alternatives.some((tool) => called.has(tool));
  });
  const expected = new Set<string>(expectations.flatMap((e) => (Array.isArray(e) ? e : [e])));
  const extra = [...called].filter((tool) => !expected.has(tool));
  return { pass: missing.length === 0, missing, extra };
}

export interface FaithfulnessResult {
  readonly pass: boolean;
  /** Canonicalized money figures in the answer that the agent never saw via a tool. */
  readonly offenders: readonly string[];
}

/**
 * No fabricated numbers: every money-shaped figure in the answer must be one the
 * agent actually saw (`allowedFigures`, reconstructed by re-executing its tool
 * calls) — or the case's ground-truth figure. Conservative by design (money-shaped
 * tokens only), so counts/years/days are never mistaken for fabricated money.
 */
export function scoreFaithfulness(
  answer: string,
  allowedFigures: readonly string[],
  groundTruth?: GroundTruth,
): FaithfulnessResult {
  const allowed = new Set(allowedFigures.map(canonicalAmount));
  if (groundTruth?.kind === "figure") {
    allowed.add(canonicalAmount(renderDecimal(groundTruth.money)));
  }
  const offenders = [...new Set(extractMoneyTokens(answer).map(canonicalAmount))].filter(
    (figure) => !allowed.has(figure),
  );
  return { pass: offenders.length === 0, offenders };
}

export interface AnswerResult {
  readonly pass: boolean;
  readonly kind: GroundTruth["kind"];
  readonly detail: string;
}

interface PartResult {
  readonly pass: boolean;
  readonly detail: string;
}

/** Score one figure/text part of an answer (shared by single cases and `all`). */
function scorePart(answer: string, part: GroundTruthPart): PartResult {
  if (part.kind === "figure") {
    const decimal = renderDecimal(part.money);
    const pass = answerContainsAmount(answer, decimal);
    return { pass, detail: pass ? `found ${decimal}` : `missing ${decimal}` };
  }
  const lower = answer.toLowerCase();
  const missing = part.contains.filter((needle) => !lower.includes(needle.toLowerCase()));
  return {
    pass: missing.length === 0,
    detail: missing.length === 0 ? "all substrings present" : `missing: ${missing.join(", ")}`,
  };
}

/**
 * The gating answer metric, by ground-truth kind: `figure` → contains the exact
 * figure; `text` → contains the required substring(s); `refusal` → fabricates no
 * figure (reuses faithfulness with no ground-truth figure to allow); `all` →
 * **every** part passes (multi-tool composition: the answer must relay each result).
 */
export function scoreAnswer(
  answer: string,
  groundTruth: GroundTruth,
  allowedFigures: readonly string[],
): AnswerResult {
  switch (groundTruth.kind) {
    case "figure":
    case "text": {
      const { pass, detail } = scorePart(answer, groundTruth);
      return { pass, kind: groundTruth.kind, detail };
    }
    case "refusal": {
      const faithfulness = scoreFaithfulness(answer, allowedFigures);
      return {
        pass: faithfulness.pass,
        kind: "refusal",
        detail: faithfulness.pass
          ? "declined without a fabricated figure"
          : `fabricated figure(s): ${faithfulness.offenders.join(", ")}`,
      };
    }
    case "all": {
      const parts = groundTruth.parts.map((part) => scorePart(answer, part));
      return {
        pass: parts.every((part) => part.pass),
        kind: "all",
        detail: parts.map((part) => `[${part.pass ? "ok" : "miss"}] ${part.detail}`).join("; "),
      };
    }
    default: {
      // Exhaustiveness guard: a new GroundTruth kind must add a branch above.
      const exhaustive: never = groundTruth;
      throw new Error(`unhandled ground-truth kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface ScopeResult {
  readonly pass: boolean;
  readonly violations: readonly string[];
}

/**
 * Did the agent stay in scope? No `list_accounts`, and no tool call addressing a
 * *different* account id. (The production `canUseTool` injects the scoped id, so a
 * present-but-foreign id here is a behavioural signal — Haiku mis-passing — not a
 * breach; an omitted id is fine, the guard supplies it.)
 */
export function scoreScope(
  toolCalls: readonly AgentToolCall[],
  scopedAccountId: string,
): ScopeResult {
  const violations: string[] = [];
  for (const call of toolCalls) {
    if (call.tool === LIST_ACCOUNTS) {
      violations.push("called list_accounts");
    }
    const passed = call.input.accountId;
    if (typeof passed === "string" && passed !== scopedAccountId) {
      violations.push(`${call.tool} addressed accountId ${JSON.stringify(passed)}`);
    }
  }
  return { pass: violations.length === 0, violations };
}
