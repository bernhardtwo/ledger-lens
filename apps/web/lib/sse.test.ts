import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./contracts";
import { parseSseChunk, streamAgent } from "./sse";

const TC = `data: {"type":"tool_call","tool":"summarize_account","input":{"accountId":"a"}}`;
const TR = `data: {"type":"tool_result","tool":"summarize_account","ok":true}`;
const DONE = `data: {"type":"done","stopReason":"ok","meta":{"model":"m","turns":2}}`;

describe("parseSseChunk", () => {
  it("parses multiple frames in one chunk", () => {
    const { events, buffer } = parseSseChunk("", `${TC}\n\n${TR}\n\n${DONE}\n\n`);
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "done"]);
    expect(buffer).toBe("");
  });

  it("buffers a frame split across chunk boundaries", () => {
    const r1 = parseSseChunk("", `data: {"type":"answer",`);
    expect(r1.events).toEqual([]);
    expect(r1.buffer).toBe(`data: {"type":"answer",`);

    const r2 = parseSseChunk(r1.buffer, `"text":"hi"}\n\n`);
    expect(r2.events).toEqual([{ type: "answer", text: "hi" }]);
    expect(r2.buffer).toBe("");
  });

  it("keeps a trailing partial frame in the buffer (not emitted yet)", () => {
    const { events, buffer } = parseSseChunk("", `${TC}\n\ndata: {"type":"ans`);
    expect(events.map((e) => e.type)).toEqual(["tool_call"]);
    expect(buffer).toBe(`data: {"type":"ans`);
  });

  it("ignores heartbeat comments and invalid frames", () => {
    const { events } = parseSseChunk("", `: ping\n\ndata: not-json\n\n${DONE}\n\n`);
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  it("ignores a frame that parses but fails the AgentEvent schema", () => {
    const { events } = parseSseChunk("", `data: {"type":"bogus","x":1}\n\n${DONE}\n\n`);
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });
});

/** A ReadableStream that emits `chunks` (UTF-8) one read at a time, then closes. */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      i += 1;
      controller.enqueue(encoder.encode(chunk));
    },
  });
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of gen) {
    out.push(event);
  }
  return out;
}

describe("streamAgent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("yields a single terminal error event on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );
    const events = await collect(streamAgent("a", "q", new AbortController().signal));
    expect(events).toEqual([
      { type: "error", code: "agent_error", message: "request failed (502)" },
    ]);
  });

  it("parses a frame stream split across chunk boundaries into ordered events", async () => {
    const body = bodyOf([
      `${TC}\n\n`,
      `data: {"type":"answer",`, // answer frame split across two reads
      `"text":"hi"}\n\n${DONE}\n\n`,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const events = await collect(streamAgent("a", "q", new AbortController().signal));
    expect(events.map((e) => e.type)).toEqual(["tool_call", "answer", "done"]);
  });

  it("propagates an abort as a throw — never a swallowed error event", async () => {
    // Real fetch rejects with an AbortError when the signal is already aborted. The
    // generator must NOT translate that into an `error` event (the caller knows it
    // aborted and suppresses it); it must throw out so the abort stays distinguishable.
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    await expect(collect(streamAgent("a", "q", controller.signal))).rejects.toThrow();
  });
});
