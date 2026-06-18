import { EventEmitter } from "node:events";
import type { Database } from "@ledger-lens/db";
import { type AgentEvent, AgentEventSchema } from "@ledger-lens/shared";
import type { Response } from "express";
import { describe, expect, it } from "vitest";
import type { StreamingQaAgent } from "../../agent/types.js";
import { AskStreamService } from "./ask-stream.service.js";

/**
 * Makes the three guarantees in the `AskStreamService` doc-comment executable
 * (ADR-0010): a mid-stream fault degrades to a terminal `error` frame, a client
 * disconnect cancels the agent loop, and a pre-stream fault re-throws so the HTTP
 * layer can still set a real status. The scripted itest double never throws and
 * ignores the `AbortSignal`, so it asserts none of this; the double below CAN throw
 * at a chosen point and DOES observe the signal.
 */

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const TERMINAL_ERROR: AgentEvent = {
  type: "error",
  code: "agent_error",
  message: "the agent could not complete the request",
};

type FaultPoint = "none" | "before-first-frame" | "after-first-frame";

class FakeStreamingAgent implements StreamingQaAgent {
  sawAbort = false;

  constructor(
    private readonly script: readonly AgentEvent[],
    private readonly faultAt: FaultPoint,
  ) {}

  async *askStream(
    _input: { readonly accountId: string; readonly question: string },
    controller?: AbortController,
  ): AsyncGenerator<AgentEvent> {
    if (this.faultAt === "before-first-frame") {
      throw new Error("pre-stream fault");
    }
    for (const [index, event] of this.script.entries()) {
      yield event;
      if (this.faultAt === "after-first-frame" && index === 0) {
        throw new Error("mid-stream fault");
      }
      // Cooperative cancellation between frames, as a real loop has — and the
      // scripted itest double does not.
      await Promise.resolve();
      if (controller?.signal.aborted) {
        this.sawAbort = true;
        return;
      }
    }
  }
}

class FakeResponse extends EventEmitter {
  headersSent = false;
  ended = false;
  readonly writes: string[] = [];
  /** Writes/`end` throw once this many frames have landed — a socket destroyed without an 'error' event. */
  failAfterWrites = Number.POSITIVE_INFINITY;
  /** Emit 'close' (a client disconnect) right after this many frames have landed. */
  closeAfterWrites = Number.POSITIVE_INFINITY;

  setHeader(): this {
    return this;
  }
  flushHeaders(): void {
    this.headersSent = true;
  }
  write(chunk: string): boolean {
    if (this.writes.length >= this.failAfterWrites) {
      throw new Error("EPIPE: write to a destroyed socket");
    }
    this.writes.push(chunk);
    if (this.writes.length >= this.closeAfterWrites) {
      this.emit("close");
    }
    return true;
  }
  end(): this {
    if (this.writes.length >= this.failAfterWrites) {
      throw new Error("write after end on a destroyed socket");
    }
    this.ended = true;
    return this;
  }
}

function serviceWith(agent: StreamingQaAgent): AskStreamService {
  // getAccountById only needs a non-null row; the DB itself is out of scope here.
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [{ id: ACCOUNT_ID }] }) }) }),
  } as unknown as Database;
  return new AskStreamService(db, agent);
}

function framesOf(res: FakeResponse): AgentEvent[] {
  return res.writes.map((chunk) =>
    AgentEventSchema.parse(JSON.parse(chunk.slice("data: ".length).trim())),
  );
}

function run(service: AskStreamService, res: FakeResponse): Promise<void> {
  return service.stream(ACCOUNT_ID, "question?", res as unknown as Response);
}

describe("AskStreamService — documented streaming guarantees (ADR-0010)", () => {
  const toolCall: AgentEvent = { type: "tool_call", tool: "summarize_account", input: {} };

  it("degrades a mid-stream fault to a terminal error frame and ends the stream", async () => {
    const res = new FakeResponse();

    await run(serviceWith(new FakeStreamingAgent([toolCall], "after-first-frame")), res);

    expect(framesOf(res)).toEqual([toolCall, TERMINAL_ERROR]);
    expect(res.ended).toBe(true);
  });

  it("does not throw when the terminal-error write hits a destroyed socket", async () => {
    const res = new FakeResponse();
    res.failAfterWrites = 1; // first frame lands; the terminal write + end hit a dead socket

    await expect(
      run(serviceWith(new FakeStreamingAgent([toolCall], "after-first-frame")), res),
    ).resolves.toBeUndefined();
    expect(res.writes).toHaveLength(1);
  });

  it("cancels the agent loop and stops streaming when the client disconnects", async () => {
    const res = new FakeResponse();
    res.closeAfterWrites = 1; // client drops right after the first frame
    const agent = new FakeStreamingAgent([toolCall, { type: "answer", text: "unreached" }], "none");

    await run(serviceWith(agent), res);

    expect(agent.sawAbort).toBe(true);
    expect(framesOf(res)).toEqual([toolCall]); // the answer is never streamed
  });

  it("re-throws a pre-stream fault before any header is sent", async () => {
    const res = new FakeResponse();

    await expect(
      run(serviceWith(new FakeStreamingAgent([], "before-first-frame")), res),
    ).rejects.toThrow("pre-stream fault");
    expect(res.headersSent).toBe(false);
    expect(res.writes).toHaveLength(0);
  });
});
