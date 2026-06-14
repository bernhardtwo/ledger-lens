import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports ok with no dependencies", () => {
    // Liveness must not depend on the DB or the Anthropic key (ADR-0011), so the
    // controller is constructed bare — no DI, no DB module.
    expect(new HealthController().check()).toEqual({ status: "ok" });
  });
});
