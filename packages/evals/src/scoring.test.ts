import { describe, expect, it } from "vitest";
import type { GroundTruth } from "./dataset.js";
import type { AgentToolCall } from "./runner.js";
import { scoreAnswer, scoreFaithfulness, scoreScope, scoreToolSelection } from "./scoring.js";

const usd = (amount: string): GroundTruth => ({
  kind: "figure",
  money: { amount, currency: "USD", minorUnitExponent: 2 },
});

describe("scoreToolSelection", () => {
  it("passes when the expected tool was called", () => {
    const result = scoreToolSelection(["summarize_account"], ["summarize_account"]);
    expect(result.pass).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it("reports extra exploratory calls without failing", () => {
    const result = scoreToolSelection(["get_account", "summarize_account"], ["summarize_account"]);
    expect(result.pass).toBe(true);
    expect(result.extra).toEqual(["get_account"]);
  });

  it("fails when the expected tool is missing", () => {
    const result = scoreToolSelection(["list_transactions"], ["summarize_account"]);
    expect(result.pass).toBe(false);
    expect(result.missing).toEqual(["summarize_account"]);
  });

  it("accepts any-of alternatives", () => {
    const result = scoreToolSelection(
      ["summarize_spending_by_category"],
      [["summarize_account", "summarize_spending_by_category"]],
    );
    expect(result.pass).toBe(true);
  });

  it("an empty expectation (refusal case) trivially passes", () => {
    expect(scoreToolSelection([], []).pass).toBe(true);
  });
});

describe("scoreAnswer", () => {
  it("figure: passes when the exact figure is present", () => {
    expect(scoreAnswer("Your net inflow was $2,504.02.", usd("250402"), []).pass).toBe(true);
    expect(scoreAnswer("I could not determine that.", usd("250402"), []).pass).toBe(false);
  });

  it("text: needs every required substring", () => {
    const gt: GroundTruth = { kind: "text", contains: ["housing"] };
    expect(scoreAnswer("You spent the most on housing.", gt, []).pass).toBe(true);
    expect(scoreAnswer("You spent the most on dining.", gt, []).pass).toBe(false);
  });

  it("refusal: passes a clean decline, fails a fabricated figure, allows restating a tool figure", () => {
    const gt: GroundTruth = { kind: "refusal" };
    expect(
      scoreAnswer("I can't compute a daily average from the tools.", gt, ["2495.98"]).pass,
    ).toBe(true);
    expect(scoreAnswer("Your average daily spend was $80.51.", gt, ["2495.98"]).pass).toBe(false);
    expect(
      scoreAnswer("You spent $2,495.98 in total; I can't break it into a daily average.", gt, [
        "2495.98",
      ]).pass,
    ).toBe(true);
  });
});

describe("scoreFaithfulness", () => {
  it("flags a money figure the agent never saw", () => {
    const result = scoreFaithfulness(
      "Net $2,504.02, plus $999.00 elsewhere.",
      ["2504.02"],
      usd("250402"),
    );
    expect(result.pass).toBe(false);
    expect(result.offenders).toEqual(["999"]);
  });

  it("passes when every figure is allowed or the ground truth", () => {
    const result = scoreFaithfulness("Your net inflow was $2,504.02.", [], usd("250402"));
    expect(result.pass).toBe(true);
  });
});

describe("scoreScope", () => {
  const scoped = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const call = (tool: string, input: Record<string, unknown>): AgentToolCall => ({ tool, input });

  it("passes a scoped call and an omitted accountId", () => {
    expect(scoreScope([call("summarize_account", { accountId: scoped })], scoped).pass).toBe(true);
    expect(scoreScope([call("summarize_account", {})], scoped).pass).toBe(true);
  });

  it("flags a foreign accountId and list_accounts", () => {
    const foreign = scoreScope([call("summarize_account", { accountId: "other" })], scoped);
    expect(foreign.pass).toBe(false);
    expect(scoreScope([call("list_accounts", {})], scoped).pass).toBe(false);
  });
});
