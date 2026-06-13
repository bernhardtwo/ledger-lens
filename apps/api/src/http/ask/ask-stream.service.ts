/**
 * SSE orchestration for `POST /accounts/:accountId/ask/stream` (ADR-0010). Relays
 * the agent's `AgentEvent` sequence as `text/event-stream`, designed for a
 * `fetch()` + `ReadableStream` client. No LLM/tool/money logic of its own — that
 * is the agent + the deterministic MCP tools.
 */
import { type Database, getAccountById } from "@ledger-lens/db";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Response } from "express";
import type { StreamingQaAgent } from "../../agent/types.js";
import { DATABASE } from "../database/database.tokens.js";
import { QA_AGENT } from "./ask.tokens.js";

@Injectable()
export class AskStreamService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(QA_AGENT) private readonly agent: StreamingQaAgent,
  ) {}

  /**
   * The deterministic 404 pre-check runs BEFORE any header is written (ADR-0010),
   * so an unknown account is a clean 404, not a half-open stream. Headers are
   * deferred to the first event so a pre-stream fault (missing key / DATABASE_URL)
   * still surfaces as a 500 via the exception filter; once the stream is open, a
   * mid-flight fault is a terminal `error` event (the HTTP status is already sent).
   * If the client disconnects, the `AbortController` cancels the agent loop so a
   * dropped connection stops spending tokens.
   */
  async stream(accountId: string, question: string, res: Response): Promise<void> {
    const account = await getAccountById(this.db, accountId);
    if (account === null) {
      throw new NotFoundException(`account ${accountId} not found`);
    }

    const controller = new AbortController();
    let closed = false;
    const onClose = (): void => {
      closed = true;
      controller.abort();
    };
    res.on("close", onClose);
    res.on("error", onClose); // swallow broken-pipe so a dropped socket can't crash

    let open = false;
    try {
      for await (const event of this.agent.askStream({ accountId, question }, controller)) {
        if (closed) {
          break;
        }
        if (!open) {
          // @Res() takes over the response, so @HttpCode is ignored and POST would
          // default to 201 — pin it to 200 (this is a stream, not a creation).
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          // Ask intermediary proxies (incl. the Phase 6 Next dev proxy) not to
          // buffer — the un-buffering check is the Chunk B verification gate.
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders();
          open = true;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      if (!open) {
        // Faulted before any event (e.g. missing key) -> let the exception filter
        // turn it into a proper HTTP status; nothing has been written yet.
        throw error;
      }
      if (!closed) {
        // Already streaming: the status is sent, so degrade to a terminal error event.
        res.write(
          `data: ${JSON.stringify({ type: "error", code: "agent_error", message: "the agent could not complete the request" })}\n\n`,
        );
      }
    } finally {
      if (open && !closed) {
        res.end();
      }
    }
  }
}
