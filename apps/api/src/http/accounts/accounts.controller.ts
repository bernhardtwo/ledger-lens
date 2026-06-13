/**
 * `GET /accounts` — list the demo seed accounts for the no-auth picker (Phase 6).
 * Read-only; the response is validated against the shared `AccountsResponseSchema`
 * in the service.
 */
import type { AccountsResponse } from "@ledger-lens/shared";
import { Controller, Get, Inject } from "@nestjs/common";
import { AccountsService } from "./accounts.service.js";

@Controller("accounts")
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get()
  async list(): Promise<AccountsResponse> {
    return this.accounts.list();
  }
}
