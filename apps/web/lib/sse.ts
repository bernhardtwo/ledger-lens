/**
 * SSE consumption for the streaming Q&A endpoint (ADR-0010). The browser POSTs to
 * the same-origin `/api/.../ask/stream` and reads `text/event-stream` via
 * `fetch()` + `ReadableStream` — NOT `EventSource`, which is GET-only and can't
 * carry the question body. The frame parser is pure and the priority for tests:
 * it buffers across chunk boundaries and splits on the `\n\n` frame delimiter.
 */
import { type AgentEvent, AgentEventSchema } from "./contracts";

export interface ParseResult {
  readonly events: AgentEvent[];
  readonly buffer: string;
}

/**
 * Append `chunk` to the carried `buffer`, extract complete `\n\n`-delimited SSE
 * frames, and parse each frame's `data:` payload into a validated `AgentEvent`.
 * Returns the parsed events plus the leftover (incomplete) buffer. Pure.
 */
export function parseSseChunk(buffer: string, chunk: string): ParseResult {
  const parts = (buffer + chunk).split("\n\n");
  // The final part has no trailing delimiter yet → it's incomplete; carry it over.
  const rest = parts.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const frame of parts) {
    const event = parseFrame(frame);
    if (event !== null) {
      events.push(event);
    }
  }
  return { events, buffer: rest };
}

/**
 * Read a frame's `data:` payload into a validated `AgentEvent`. Per the SSE spec,
 * multiple `data:` lines in one frame join with `\n` (our server emits a single
 * line today, but we stay spec-correct so a future multi-line payload can't corrupt).
 */
function parseFrame(frame: string): AgentEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
  if (data === "") {
    return null; // heartbeat comment (": ping") or blank — not an event
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = AgentEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Consume `POST /api/accounts/:id/ask/stream` as SSE, yielding each `AgentEvent`.
 * A non-OK HTTP status (404/400/500 before the stream opens) is surfaced as a
 * terminal `error` event; a mid-stream network drop or an abort throws out of the
 * generator (the caller distinguishes abort via the signal). `signal` cancels the
 * fetch — it pairs with the server's disconnect cancellation (ADR-0010).
 */
export async function* streamAgent(
  accountId: string,
  question: string,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`/api/accounts/${accountId}/ask/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || res.body === null) {
    yield { type: "error", code: "agent_error", message: `request failed (${res.status})` };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const result = parseSseChunk(buffer, decoder.decode(value, { stream: true }));
      buffer = result.buffer;
      for (const event of result.events) {
        yield event;
      }
    }
    // Stream ended: flush any bytes the decoder held back. Frames are `\n\n`-
    // terminated, so a clean end leaves nothing to emit; a truncated final frame
    // is (correctly) left unparsed rather than surfaced half-formed.
    for (const event of parseSseChunk(buffer, decoder.decode()).events) {
      yield event;
    }
  } finally {
    reader.cancel().catch(() => {
      /* the stream is already closing */
    });
  }
}
