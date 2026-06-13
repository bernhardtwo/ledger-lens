import { describe, expect, it } from "vitest";
import { foldTurn } from "./chat-turn";

describe("foldTurn", () => {
  it("folds a happy multi-tool turn (rows ok, answer, meta)", () => {
    const s = foldTurn([
      { type: "tool_call", tool: "summarize_account", input: {} },
      { type: "tool_result", tool: "summarize_account", ok: true },
      { type: "tool_call", tool: "summarize_spending_by_category", input: { category: "dining" } },
      { type: "tool_result", tool: "summarize_spending_by_category", ok: true },
      { type: "answer", text: "You spent $54.90 on dining." },
      { type: "done", stopReason: "ok", meta: { model: "claude-haiku-4-5", turns: 3 } },
    ]);
    expect(s.tools.map((t) => [t.tool, t.status])).toEqual([
      ["summarize_account", "ok"],
      ["summarize_spending_by_category", "ok"],
    ]);
    expect(s.answer).toBe("You spent $54.90 on dining.");
    expect(s.meta).toEqual({ model: "claude-haiku-4-5", turns: 3 });
    expect(s.stopReason).toBe("ok");
    expect(s.done).toBe(true);
    expect(s.error).toBeNull();
  });

  it("marks a failed tool_result", () => {
    const s = foldTurn([
      { type: "tool_call", tool: "t", input: {} },
      { type: "tool_result", tool: "t", ok: false },
      { type: "done", stopReason: "ok", meta: { model: "m", turns: 1 } },
    ]);
    expect(s.tools[0]?.status).toBe("failed");
  });

  it("renders a limitation answer as-is (ordinary success, no special-casing)", () => {
    const s = foldTurn([
      { type: "answer", text: "The tools don't cover that." },
      { type: "done", stopReason: "ok", meta: { model: "m", turns: 1 } },
    ]);
    expect(s.answer).toBe("The tools don't cover that.");
    expect(s.stopReason).toBe("ok");
    expect(s.tools).toEqual([]);
  });

  it("flags a step-limit stop", () => {
    const s = foldTurn([
      { type: "answer", text: "I couldn't complete this within the step limit." },
      { type: "done", stopReason: "step_limit", meta: { model: "m", turns: 8 } },
    ]);
    expect(s.stopReason).toBe("step_limit");
    expect(s.done).toBe(true);
  });

  it("captures a terminal error", () => {
    const s = foldTurn([
      { type: "tool_call", tool: "t", input: {} },
      { type: "error", code: "agent_error", message: "boom" },
    ]);
    expect(s.error).toBe("boom");
    expect(s.done).toBe(true);
  });

  it("ignores an out-of-order tool_result with no running row", () => {
    const s = foldTurn([{ type: "tool_result", tool: "t", ok: true }]);
    expect(s.tools).toEqual([]);
  });

  it("ignores a duplicate tool_result (the row is already resolved)", () => {
    const s = foldTurn([
      { type: "tool_call", tool: "t", input: {} },
      { type: "tool_result", tool: "t", ok: true },
      { type: "tool_result", tool: "t", ok: false }, // dup — must not flip ok → failed
    ]);
    expect(s.tools.map((t) => t.status)).toEqual(["ok"]);
  });

  it("binds repeated calls of the same tool to results FIFO (not LIFO)", () => {
    // The same tool called twice; the FIRST result fails. Results echo tool_use
    // order, so the failure must land on the FIRST row, not the last.
    const s = foldTurn([
      { type: "tool_call", tool: "list_transactions", input: { dateFrom: "2026-01-01" } },
      { type: "tool_call", tool: "list_transactions", input: { dateFrom: "2026-02-01" } },
      { type: "tool_result", tool: "list_transactions", ok: false },
      { type: "tool_result", tool: "list_transactions", ok: true },
    ]);
    expect(s.tools.map((t) => t.status)).toEqual(["failed", "ok"]);
    expect(s.tools.map((t) => t.input.dateFrom)).toEqual(["2026-01-01", "2026-02-01"]);
  });
});
