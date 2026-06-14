import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { trace } from "@opentelemetry/api";
import { beforeAll, describe, expect, it } from "vitest";
import { instrumentAgentRun } from "./telemetry.js";

// The GATING guardrail (ADR-0013): with NO OpenTelemetry SDK registered — i.e. when
// `instrumentation.ts` did not call useAzureMonitor because the connection string is
// absent (local dev, the test suites, the eval) — instrumentAgentRun must add nothing:
// every message passes through unchanged and nothing throws. `trace.disable()` forces
// the global API back to no-op so this holds regardless of test-runner isolation.
describe("instrumentAgentRun (no OTel SDK registered → no-op)", () => {
  beforeAll(() => {
    trace.disable();
  });

  it("yields every message unchanged and never throws", async () => {
    const input: SDKMessage[] = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
      },
      {
        type: "user",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] },
      },
      { type: "result", subtype: "success", result: "ok", num_turns: 1, total_cost_usd: 0.01 },
    ] as unknown as SDKMessage[];

    async function* source(): AsyncGenerator<SDKMessage> {
      for (const message of input) {
        yield message;
      }
    }
    const out: SDKMessage[] = [];
    for await (const message of instrumentAgentRun(
      { accountId: "a", model: "m", streaming: true },
      source(),
    )) {
      out.push(message);
    }
    expect(out).toEqual(input);
  });
});
