import { afterEach, describe, expect, it, vi } from "vitest";
import { listAccounts } from "./api";

type MockRes = { ok: boolean; status: number; body: unknown };

function mockFetch(res: MockRes | "throw"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (res === "throw") {
        throw new Error("network down");
      }
      return { ok: res.ok, status: res.status, json: async () => res.body } as unknown as Response;
    }),
  );
}

const account = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Everyday Checking",
  institution: "Bank A",
  currency: "USD",
  kind: "bank",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listAccounts (client-boundary validation)", () => {
  it("parses a valid envelope through the shared schema", async () => {
    mockFetch({ ok: true, status: 200, body: { accounts: [account] } });
    await expect(listAccounts()).resolves.toEqual([account]);
  });

  it("rejects a malformed 2xx body as a contract error, NOT 'unreachable'", async () => {
    mockFetch({ ok: true, status: 200, body: { wrong: true } });
    await expect(listAccounts()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      code: "invalid-response",
    });
  });

  it("maps a network/proxy failure to status 0 'API unreachable'", async () => {
    mockFetch("throw");
    await expect(listAccounts()).rejects.toMatchObject({ status: 0, message: "API unreachable" });
  });
});

describe("error-body normalization (both server shapes)", () => {
  it("reads the domain shape { error, message, signature }", async () => {
    mockFetch({
      ok: false,
      status: 422,
      body: { error: "unknown-profile", message: "unrecognized header", signature: "date,desc" },
    });
    await expect(listAccounts()).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      code: "unknown-profile",
      signature: "date,desc",
      message: "unrecognized header",
    });
  });

  it("reads the Nest shape { statusCode, message }", async () => {
    mockFetch({
      ok: false,
      status: 404,
      body: { statusCode: 404, message: "account x not found" },
    });
    await expect(listAccounts()).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "account x not found",
    });
  });
});
