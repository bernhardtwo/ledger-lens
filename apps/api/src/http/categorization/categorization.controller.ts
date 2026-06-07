/**
 * `POST /accounts/:accountId/categorize` — enrich the account's uncategorized
 * transactions. Idempotent: once everything is categorized, a re-run is a no-op.
 * Account id validated with Zod (400); unknown account -> 404. Returns 200 (this
 * is an enrichment action, not a resource creation).
 */
import { Controller, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AccountIdSchema } from "../statements/statements.dto.js";
import { type CategorizeResponse, CategorizeResponseSchema } from "./categorization.dto.js";
import { CategorizationService } from "./categorization.service.js";

@Controller("accounts/:accountId/categorize")
export class CategorizationController {
  constructor(
    @Inject(CategorizationService) private readonly categorization: CategorizationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async categorize(
    @Param("accountId", new ZodValidationPipe(AccountIdSchema)) accountId: string,
  ): Promise<CategorizeResponse> {
    return CategorizeResponseSchema.parse(await this.categorization.categorizeAccount(accountId));
  }
}
