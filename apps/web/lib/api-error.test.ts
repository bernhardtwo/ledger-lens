import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { describeApiError } from "./api-error";

describe("describeApiError", () => {
  it("unifies the unreachable (status 0) case regardless of context", () => {
    const copy = describeApiError(new ApiError(0, "API unreachable"), "Couldn't load accounts");
    expect(copy.title).toBe("API unreachable");
    expect(copy.detail).toMatch(/API_BASE_URL/);
  });

  it("describes a contract drift (invalid-response)", () => {
    const copy = describeApiError(
      new ApiError(200, "unexpected response shape", "invalid-response"),
      "ignored",
    );
    expect(copy.title).toBe("Unexpected response");
  });

  it("maps the teachable upload codes by status", () => {
    expect(describeApiError(new ApiError(413, "too big"), "x").title).toBe("File too large");
    expect(describeApiError(new ApiError(415, "no"), "x").title).toBe("Unsupported file");
  });

  it("shows the column signature for an unknown CSV profile", () => {
    const copy = describeApiError(
      new ApiError(422, "unknown", "unknown-profile", "date,desc,amt"),
      "x",
    );
    expect(copy.title).toBe("Unrecognized CSV format");
    expect(copy.detail).toContain("date,desc,amt");
  });

  it("passes through a specific 422 message (e.g. currency mismatch)", () => {
    const copy = describeApiError(
      new ApiError(
        422,
        "file currency EUR does not match account currency USD",
        "currency-mismatch",
      ),
      "x",
    );
    expect(copy.title).toBe("Couldn't process the file");
    expect(copy.detail).toContain("EUR does not match");
  });

  it("falls back to the caller's title + the API message otherwise", () => {
    const copy = describeApiError(new ApiError(500, "server boom"), "Couldn't load transactions");
    expect(copy).toEqual({ title: "Couldn't load transactions", detail: "server boom" });
  });
});
