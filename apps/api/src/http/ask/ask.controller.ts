/**
 * `POST /accounts/:accountId/ask` (JSON) and `POST /accounts/:accountId/ask/stream`
 * (SSE, ADR-0010). Account id + body validated with Zod (400); unknown account ->
 * 404 (before any tokens / before the stream opens). A loop fault -> 502 on the JSON
 * path, a terminal `error` event on the stream.
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AccountIdSchema } from "../statements/statements.dto.js";
import { AskStreamService } from "./ask-stream.service.js";
import {
  type AskRequest,
  AskRequestSchema,
  type AskResponse,
  AskResponseSchema,
} from "./ask.dto.js";
import { AskService } from "./ask.service.js";

@Controller("accounts/:accountId/ask")
export class AskController {
  constructor(
    @Inject(AskService) private readonly ask: AskService,
    @Inject(AskStreamService) private readonly askStreamService: AskStreamService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async post(
    @Param("accountId", new ZodValidationPipe(AccountIdSchema)) accountId: string,
    @Body(new ZodValidationPipe(AskRequestSchema)) body: AskRequest,
  ): Promise<AskResponse> {
    return AskResponseSchema.parse(await this.ask.ask(accountId, body.question));
  }

  /**
   * SSE variant: relays the agent's `AgentEvent` sequence as `text/event-stream`.
   * `@Res()` (no passthrough) — the service owns the response so it can run the 404
   * pre-check before any header is written, then stream frames.
   */
  @Post("stream")
  async stream(
    @Param("accountId", new ZodValidationPipe(AccountIdSchema)) accountId: string,
    @Body(new ZodValidationPipe(AskRequestSchema)) body: AskRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.askStreamService.stream(accountId, body.question, res);
  }
}
