import { describe, expect, it } from "vitest";
import { AccountSchema, parseAccount } from "./account.js";

const VALID = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "Everyday Checking",
  institution: "Synthetic Bank",
  currency: "USD",
  kind: "bank",
} as const;

describe("Account", () => {
  it("parses a valid account", () => {
    const account = parseAccount(VALID);
    expect(account.currency).toBe("USD");
    expect(account.kind).toBe("bank");
  });

  it("rejects an unsupported currency and an unknown kind", () => {
    expect(AccountSchema.safeParse({ ...VALID, currency: "ARS" }).success).toBe(false);
    expect(AccountSchema.safeParse({ ...VALID, kind: "savings" }).success).toBe(false);
  });

  it("rejects a non-uuid id and empty names", () => {
    expect(AccountSchema.safeParse({ ...VALID, id: "abc" }).success).toBe(false);
    expect(AccountSchema.safeParse({ ...VALID, name: "" }).success).toBe(false);
    expect(AccountSchema.safeParse({ ...VALID, institution: "" }).success).toBe(false);
  });

  it("strips unknown keys (no extra fields leak through)", () => {
    const parsed = parseAccount({ ...VALID, secret: "x" });
    expect("secret" in parsed).toBe(false);
  });
});
