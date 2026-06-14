import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prefixed } from "../agent/scope.js";
import { type AgentRunMeta, instrumentAgentRun } from "./telemetry.js";

// Minimal SDK message fixtures — instrumentAgentRun reads only the fields set here
// (mirrors stream.test.ts).
function assistantToolUse(name: string, id: string, parent: string | null = null): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parent,
    message: { content: [{ type: "tool_use", id, name, input: {} }] },
  } as unknown as SDKMessage;
}
function userToolResult(toolUseId: string, isError = false): SDKMessage {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: isError }] },
  } as unknown as SDKMessage;
}
function successResult(turns: number, cost = 0.0123): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    result: "ok",
    num_turns: turns,
    total_cost_usd: cost,
  } as unknown as SDKMessage;
}

const META: AgentRunMeta = { accountId: "acc-1", model: "claude-haiku-4-5", streaming: false };

async function drain(meta: AgentRunMeta, messages: SDKMessage[]): Promise<SDKMessage[]> {
  async function* source(): AsyncGenerator<SDKMessage> {
    for (const message of messages) {
      yield message;
    }
  }
  const out: SDKMessage[] = [];
  for await (const message of instrumentAgentRun(meta, source())) {
    out.push(message);
  }
  return out;
}

const byName = (spans: ReadableSpan[], name: string) => spans.filter((s) => s.name === name);

describe("instrumentAgentRun", () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;

  beforeAll(() => {
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
  });
  afterEach(() => exporter.reset());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable(); // reset the global OTel API so other test files see a no-op
  });

  it("yields every SDK message UNCHANGED (adds no behaviour)", async () => {
    const input = [
      assistantToolUse(prefixed("summarize_account"), "tu1"),
      userToolResult("tu1"),
      successResult(2),
    ];
    const out = await drain(META, input);
    expect(out).toEqual(input);
  });

  it("emits one agent.ask span + a child agent.tool span paired by tool_use_id", async () => {
    await drain({ ...META, streaming: true }, [
      assistantToolUse(prefixed("summarize_account"), "tu1"),
      userToolResult("tu1"),
      successResult(2, 0.0123),
    ]);
    const spans = exporter.getFinishedSpans();
    const [ask] = byName(spans, "agent.ask");
    const [tool] = byName(spans, "agent.tool summarize_account");
    expect(ask).toBeDefined();
    expect(tool).toBeDefined();
    // agent.ask carries the run summary; cost is server-side telemetry only.
    expect(ask?.attributes).toMatchObject({
      "agent.model": "claude-haiku-4-5",
      "agent.streaming": true,
      "agent.turns": 2,
      "agent.tool_count": 1,
      "agent.cost_usd": 0.0123,
      "agent.stop_reason": "ok",
    });
    expect(tool?.attributes).toMatchObject({ "tool.name": "summarize_account", "tool.ok": true });
    // The tool span is a child of the agent.ask span (same trace).
    expect(tool?.spanContext().traceId).toBe(ask?.spanContext().traceId);
    expect(tool?.parentSpanContext?.spanId).toBe(ask?.spanContext().spanId);
  });

  it("marks tool.ok=false when the tool_result is an error", async () => {
    await drain(META, [
      assistantToolUse(prefixed("list_transactions"), "tu9"),
      userToolResult("tu9", true),
      successResult(1),
    ]);
    const [tool] = byName(exporter.getFinishedSpans(), "agent.tool list_transactions");
    expect(tool?.attributes).toMatchObject({ "tool.ok": false });
  });

  it("excludes sub-agent tool_use (parent_tool_use_id set) from tool spans", async () => {
    await drain(META, [
      assistantToolUse(prefixed("summarize_account"), "tu1", "parent-1"),
      successResult(1),
    ]);
    expect(byName(exporter.getFinishedSpans(), "agent.tool summarize_account")).toHaveLength(0);
  });
});
