/**
 * In-process OpenTelemetry instrumentation for the agent run (ADR-0013, spec 0007 §6.1).
 *
 * `instrumentAgentRun` wraps the live `query()` SDKMessage stream that BOTH `/ask` and
 * `/ask/stream` share (the single `AgentSdkQaAgent` seam) and yields every message
 * UNCHANGED, so it adds no behaviour and the wire contract is untouched. As messages
 * flow it emits:
 *   - one `agent.ask` span per run (model / turns / tool_count / cost_usd / stop_reason),
 *   - a child `agent.tool <name>` span per MCP tool-call (started on the `tool_use`
 *     block, ended on the matching `tool_result` by id — so its duration is the
 *     orchestrator's api-observed call->result round-trip, NOT the in-DB query time),
 *   - `agent.cost_usd` / `agent.turns` metrics.
 *
 * Everything goes through `@opentelemetry/api`, which returns NO-OP tracers/meters when
 * no SDK is registered (i.e. when `instrumentation.ts` did not call `useAzureMonitor`
 * because `APPLICATIONINSIGHTS_CONNECTION_STRING` is absent). So with no connection
 * string this is a cheap no-op: local dev, the test suites, and the eval are unchanged.
 * Cost is a span attribute / metric only — server-side, never on the wire (ADR-0008 §6).
 */
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type Context,
  type Histogram,
  type Span,
  SpanStatusCode,
  context,
  metrics,
  trace,
} from "@opentelemetry/api";
import { stripPrefix } from "../agent/scope.js";

const INSTRUMENTATION_NAME = "ledger-lens-api";

const tracer = () => trace.getTracer(INSTRUMENTATION_NAME);

// Instruments are created lazily and cached: by first use the SDK (if any) is already
// registered by `instrumentation.ts` (`node --import`, before the app loads).
let costHistogram: Histogram | undefined;
let turnsHistogram: Histogram | undefined;
function costMetric(): Histogram {
  costHistogram ??= metrics
    .getMeter(INSTRUMENTATION_NAME)
    .createHistogram("agent.cost_usd", { description: "Agent run cost per /ask", unit: "USD" });
  return costHistogram;
}
function turnsMetric(): Histogram {
  turnsHistogram ??= metrics
    .getMeter(INSTRUMENTATION_NAME)
    .createHistogram("agent.turns", { description: "Agentic turns per /ask" });
  return turnsHistogram;
}

export interface AgentRunMeta {
  readonly accountId: string;
  readonly model: string;
  readonly streaming: boolean;
}

/** Map the SDK result subtype to the wire `stopReason` vocabulary (server-side mirror). */
function stopReason(subtype: SDKResultMessage["subtype"]): string {
  if (subtype === "success") {
    return "ok";
  }
  if (subtype === "error_max_turns" || subtype === "error_max_budget_usd") {
    return "step_limit";
  }
  return "error";
}

/**
 * Start a child span when the main agent issues a `tool_use`, end it when the matching
 * `tool_result` arrives (paired by `tool_use_id`). Mirrors the main-thread filter in
 * `stream.ts` (`parent_tool_use_id === null`) so sub-agent traffic is excluded. Returns
 * the number of tool spans STARTED by this message (so the caller can total them).
 */
function handleToolSpans(message: SDKMessage, runCtx: Context, open: Map<string, Span>): number {
  if (message.type === "assistant" && message.parent_tool_use_id === null) {
    let started = 0;
    for (const block of message.message.content) {
      if (block.type === "tool_use") {
        const name = stripPrefix(block.name);
        const span = tracer().startSpan(
          `agent.tool ${name}`,
          { attributes: { "tool.name": name } },
          runCtx,
        );
        open.set(block.id, span);
        started += 1;
      }
    }
    return started;
  }
  if (message.type === "user" && message.parent_tool_use_id === null) {
    const content = message.message.content;
    if (!Array.isArray(content)) {
      return 0;
    }
    for (const block of content) {
      if (block.type === "tool_result") {
        const span = open.get(block.tool_use_id);
        if (span !== undefined) {
          const ok = block.is_error !== true;
          span.setAttribute("tool.ok", ok);
          span.setStatus({ code: ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
          span.end();
          open.delete(block.tool_use_id);
        }
      }
    }
  }
  return 0;
}

/**
 * Wrap the agent's `query()` SDKMessage stream with telemetry, yielding each message
 * unchanged. No-op when no OTel SDK is registered.
 */
export async function* instrumentAgentRun(
  meta: AgentRunMeta,
  source: AsyncIterable<SDKMessage>,
): AsyncGenerator<SDKMessage> {
  const span = tracer().startSpan("agent.ask", {
    attributes: {
      "agent.model": meta.model,
      "agent.streaming": meta.streaming,
      "ledgerlens.account_id": meta.accountId,
    },
  });
  const runCtx = trace.setSpan(context.active(), span);
  const toolSpans = new Map<string, Span>();
  let toolCount = 0;
  // "missing" = no result message; "error" = an agent fault result (stopReason error)
  // — both end the span ERROR so App Insights failure views surface them.
  let outcome: "ok" | "error" | "missing" = "missing";
  try {
    for await (const message of source) {
      toolCount += handleToolSpans(message, runCtx, toolSpans);
      if (message.type === "result") {
        const turns = message.num_turns;
        const cost = message.total_cost_usd ?? 0;
        const reason = stopReason(message.subtype);
        span.setAttribute("agent.turns", turns);
        span.setAttribute("agent.cost_usd", cost); // server-side telemetry only
        span.setAttribute("agent.stop_reason", reason);
        costMetric().record(cost, { "agent.model": meta.model });
        turnsMetric().record(turns, { "agent.model": meta.model });
        outcome = reason === "error" ? "error" : "ok";
      }
      yield message;
    }
    span.setStatus(
      outcome === "ok"
        ? { code: SpanStatusCode.OK }
        : {
            code: SpanStatusCode.ERROR,
            message: outcome === "missing" ? "no result message" : "agent error result",
          },
    );
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    // Record the tool count for EVERY run (incl. faulted ones), then end any tool span
    // left open by an aborted/faulted run before ending the agent span.
    span.setAttribute("agent.tool_count", toolCount);
    for (const toolSpan of toolSpans.values()) {
      toolSpan.end();
    }
    span.end();
  }
}
