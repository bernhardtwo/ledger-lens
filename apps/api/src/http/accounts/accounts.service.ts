/**
 * Accounts service — backs the read-only `GET /accounts` picker (Phase 6, no auth).
 * Delegates to the existing `listAccounts` repository and maps each DB row to the
 * shared `Account` DTO (`currencyCode` -> `currency`). No logic of its own.
 */
import { type Database, listAccounts } from "@ledger-lens/db";
import { type AccountsResponse, AccountsResponseSchema } from "@ledger-lens/shared";
import { Inject, Injectable } from "@nestjs/common";
import { DATABASE } from "../database/database.tokens.js";

@Injectable()
export class AccountsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<AccountsResponse> {
    const rows = await listAccounts(this.db);
    return AccountsResponseSchema.parse({
      accounts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        institution: row.institution,
        currency: row.currencyCode,
        kind: row.kind,
      })),
    });
  }
}
