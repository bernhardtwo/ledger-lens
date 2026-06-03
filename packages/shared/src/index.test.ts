import { describe, expect, it } from "vitest";
import { type FeatureBoundary, PROJECT_NAME } from "./index.js";

describe("shared", () => {
  it("exposes the project name", () => {
    expect(PROJECT_NAME).toBe("ledger-lens");
  });

  it("models a feature boundary", () => {
    const boundary: FeatureBoundary = {
      name: "metric-computation",
      kind: "deterministic",
      rationale: "Pure arithmetic over stored transactions; no LLM needed.",
    };
    expect(boundary.kind).toBe("deterministic");
  });
});
