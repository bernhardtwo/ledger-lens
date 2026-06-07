/**
 * Transactions service — 404s an unknown account, then delegates to the EXISTING
 * `listTransactions` repository (keyset pagination, `raw_row` excluded) and maps
 * each row to the canonical DTO. No query/money logic of its own.
 */
import { type Database, getAccountById, listTransactions } from "@ledger-lens/db";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DATABASE } from "../database/database.tokens.js";
import {
  type ListQuery,
  type TransactionsPageResponse,
  TransactionsPageResponseSchema,
  toTransactionListItem,
} from "./transactions.dto.js";

@Injectable()
export class TransactionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(accountId: string, query: ListQuery): Promise<TransactionsPageResponse> {
    const account = await getAccountById(this.db, accountId);
    if (account === null) {
      throw new NotFoundException(`account ${accountId} not found`);
    }

    // `listTransactions` throws InvalidCursorError on a bad cursor (mapped to 400).
    const page = await listTransactions(this.db, {
      accountId,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });

    return TransactionsPageResponseSchema.parse({
      items: page.items.map(toTransactionListItem),
      nextCursor: page.nextCursor,
    });
  }
}
