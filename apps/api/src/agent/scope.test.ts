import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SCOPED_TOOLS,
  TOOL_PREFIX,
  prefixed,
  resolveToolCall,
  stripPrefix,
} from "./scope.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("resolveToolCall", () => {
  it("allows each account-scoped tool, injecting the scoped accountId", () => {
    for (const tool of ACCOUNT_SCOPED_TOOLS) {
      expect(resolveToolCall(ACCOUNT, prefixed(tool), { accountId: ACCOUNT })).toEqual({
        allowed: true,
        updatedInput: { accountId: ACCOUNT },
      });
    }
  });

  it("OVERWRITES a foreign accountId with the scoped one (injection, not rejection)", () => {
    const decision = resolveToolCall(ACCOUNT, prefixed("summarize_account"), { accountId: OTHER });
    expect(decision).toEqual({ allowed: true, updatedInput: { accountId: ACCOUNT } });
  });

  it("injects the accountId when the model omitted it, preserving other args", () => {
    const decision = resolveToolCall(ACCOUNT, prefixed("list_transactions"), {
      category: "dining",
    });
    expect(decision).toEqual({
      allowed: true,
      updatedInput: { category: "dining", accountId: ACCOUNT },
    });
  });

  it("denies list_accounts outright (even with the right accountId)", () => {
    expect(resolveToolCall(ACCOUNT, prefixed("list_accounts"), {}).allowed).toBe(false);
    expect(
      resolveToolCall(ACCOUNT, prefixed("list_accounts"), { accountId: ACCOUNT }).allowed,
    ).toBe(false);
  });

  it("denies any unknown / built-in / foreign-server tool", () => {
    expect(resolveToolCall(ACCOUNT, "Bash", { accountId: ACCOUNT }).allowed).toBe(false);
    expect(resolveToolCall(ACCOUNT, "mcp__other__do_thing", { accountId: ACCOUNT }).allowed).toBe(
      false,
    );
  });

  it("works on bare (unprefixed) domain names too", () => {
    expect(resolveToolCall(ACCOUNT, "summarize_account", { accountId: ACCOUNT })).toEqual({
      allowed: true,
      updatedInput: { accountId: ACCOUNT },
    });
  });
});

describe("prefix helpers", () => {
  it("round-trips the mcp prefix", () => {
    expect(prefixed("summarize_account")).toBe(`${TOOL_PREFIX}summarize_account`);
    expect(stripPrefix(prefixed("summarize_account"))).toBe("summarize_account");
    expect(stripPrefix("summarize_account")).toBe("summarize_account");
  });
});
