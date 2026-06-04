/**
 * Account domain type (see spec 0001).
 *
 * An `Account` is the owner of statements and transactions. Its fields are all
 * JSON-safe primitives (no `Money`, no `Date`), so the domain shape and the
 * boundary DTO are identical and a single Zod schema is the source of truth —
 * no separate value-object/DTO split is needed here (unlike `Money`/`Statement`
 * /`Transaction`). The account's `currency` is the expected currency of its
 * transactions; cross-checking each `Transaction.amount.currency` against it is
 * an ingestion-time concern, not encodable in this single-entity schema.
 */
import { z } from "zod";
import { CurrencyCodeSchema } from "./currency.js";

/** Whether the account is a debit/asset ("bank") or liability ("credit") line. */
export const AccountKindSchema = z.enum(["bank", "credit"]);
export type AccountKind = z.infer<typeof AccountKindSchema>;

/** Trust-boundary schema for an `Account` (also its in-memory shape). */
export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  institution: z.string().min(1),
  currency: CurrencyCodeSchema,
  kind: AccountKindSchema,
});

/** An account; JSON-safe, so domain and DTO coincide. */
export type Account = z.infer<typeof AccountSchema>;

/** Validate an unknown input into an `Account` at a trust boundary. */
export function parseAccount(input: unknown): Account {
  return AccountSchema.parse(input);
}
