import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SCOPED_TOOLS,
  TOOL_PREFIX,
  assertInScope,
  prefixed,
  stripPrefix,
} from "./scope.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("assertInScope", () => {
  it("allows each account-scoped tool when the accountId matches", () => {
    for (const tool of ACCOUNT_SCOPED_TOOLS) {
      expect(assertInScope(ACCOUNT, prefixed(tool), { accountId: ACCOUNT })).toEqual({
        allowed: true,
      });
    }
  });

  it("denies a tool call carrying another account's id", () => {
    expect(
      assertInScope(ACCOUNT, prefixed("summarize_account"), { accountId: OTHER }).allowed,
    ).toBe(false);
  });

  it("denies a tool call with a missing accountId", () => {
    expect(assertInScope(ACCOUNT, prefixed("list_transactions"), {}).allowed).toBe(false);
  });

  it("denies list_accounts outright (even with the right accountId)", () => {
    expect(assertInScope(ACCOUNT, prefixed("list_accounts"), {}).allowed).toBe(false);
    expect(assertInScope(ACCOUNT, prefixed("list_accounts"), { accountId: ACCOUNT }).allowed).toBe(
      false,
    );
  });

  it("denies any unknown / built-in / foreign-server tool", () => {
    expect(assertInScope(ACCOUNT, "Bash", { accountId: ACCOUNT }).allowed).toBe(false);
    expect(assertInScope(ACCOUNT, "mcp__other__do_thing", { accountId: ACCOUNT }).allowed).toBe(
      false,
    );
  });

  it("works on bare (unprefixed) domain names too", () => {
    expect(assertInScope(ACCOUNT, "summarize_account", { accountId: ACCOUNT })).toEqual({
      allowed: true,
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
