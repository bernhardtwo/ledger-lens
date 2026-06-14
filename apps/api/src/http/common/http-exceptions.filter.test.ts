import { type ArgumentsHost, BadGatewayException, NotFoundException } from "@nestjs/common";
import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HttpExceptionsFilter } from "./http-exceptions.filter.js";

// A response double capturing the status/body the filter writes.
function fakeHost(): { host: ArgumentsHost; res: { statusCode: number; body: unknown } } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

// Run filter.catch with `span` active, then end it and return the recorded span.
function catchWithSpan(
  filter: HttpExceptionsFilter,
  exception: unknown,
  exporter: InMemorySpanExporter,
): { recorded: ReadableSpan; status: number } {
  const span = trace.getTracer("test").startSpan("req");
  const { host, res } = fakeHost();
  context.with(trace.setSpan(context.active(), span), () => filter.catch(exception, host));
  span.end();
  const recorded = exporter.getFinishedSpans().at(-1);
  if (recorded === undefined) {
    throw new Error("no span recorded");
  }
  return { recorded, status: res.statusCode };
}

describe("HttpExceptionsFilter — span recording (ADR-0013)", () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;
  const filter = new HttpExceptionsFilter();

  beforeAll(() => {
    // A context manager is required for `trace.getActiveSpan()` to resolve the span set
    // by `context.with` (in production the Azure Monitor distro registers one).
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
  });
  afterEach(() => exporter.reset());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });

  it("records a 5xx HttpException (the agent 502) on the active span", () => {
    const { recorded, status } = catchWithSpan(
      filter,
      new BadGatewayException("agent down"),
      exporter,
    );
    expect(status).toBe(502);
    expect(recorded.status.code).toBe(SpanStatusCode.ERROR);
    expect(recorded.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("records a non-HttpException as a 500 on the active span", () => {
    const { recorded, status } = catchWithSpan(filter, new Error("boom"), exporter);
    expect(status).toBe(500);
    expect(recorded.status.code).toBe(SpanStatusCode.ERROR);
    expect(recorded.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("does NOT record a 4xx client error (noise) on the span", () => {
    const { recorded, status } = catchWithSpan(filter, new NotFoundException("nope"), exporter);
    expect(status).toBe(404);
    expect(recorded.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(recorded.events.some((e) => e.name === "exception")).toBe(false);
  });
});
