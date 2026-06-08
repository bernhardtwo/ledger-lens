/**
 * `POST /accounts/:accountId/ask` — answer a natural-language question about the
 * account by orchestrating the read-only MCP tools. Account id validated with Zod
 * (400); unknown account -> 404; the agent's answer is 200 (even an honest "I
 * don't have that"); a loop fault -> 502 (see ADR-0008 §7).
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AccountIdSchema } from "../statements/statements.dto.js";
import {
  type AskRequest,
  AskRequestSchema,
  type AskResponse,
  AskResponseSchema,
} from "./ask.dto.js";
import { AskService } from "./ask.service.js";

@Controller("accounts/:accountId/ask")
export class AskController {
  constructor(@Inject(AskService) private readonly ask: AskService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async post(
    @Param("accountId", new ZodValidationPipe(AccountIdSchema)) accountId: string,
    @Body(new ZodValidationPipe(AskRequestSchema)) body: AskRequest,
  ): Promise<AskResponse> {
    return AskResponseSchema.parse(await this.ask.ask(accountId, body.question));
  }
}
