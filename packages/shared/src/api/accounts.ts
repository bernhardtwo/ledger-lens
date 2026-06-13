/**
 * Response envelope for the read-only `GET /accounts` endpoint (Phase 6). The
 * picker has no auth and lists the demo seed accounts; the account shape is the
 * domain `Account` (JSON-safe, domain == DTO). Lives in `@ledger-lens/shared` so
 * the server's response-validation pipe and the web client share the identical
 * Zod symbol.
 */
import { z } from "zod";
import { AccountSchema } from "../domain/account.js";

export const AccountsResponseSchema = z.object({
  accounts: z.array(AccountSchema),
});
export type AccountsResponse = z.infer<typeof AccountsResponseSchema>;
