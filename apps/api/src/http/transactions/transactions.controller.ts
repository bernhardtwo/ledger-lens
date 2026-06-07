/**
 * `GET /accounts/:accountId/transactions?limit&cursor` — keyset-paginated list,
 * `raw_row` excluded. Account id + query validated with Zod at the edge.
 */
import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AccountIdSchema } from "../statements/statements.dto.js";
import {
  type ListQuery,
  ListQuerySchema,
  type TransactionsPageResponse,
} from "./transactions.dto.js";
import { TransactionsService } from "./transactions.service.js";

@Controller("accounts/:accountId/transactions")
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Get()
  async list(
    @Param("accountId", new ZodValidationPipe(AccountIdSchema)) accountId: string,
    @Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery,
  ): Promise<TransactionsPageResponse> {
    return this.transactions.list(accountId, query);
  }
}
