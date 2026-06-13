import { z } from "zod";

// The ingest response envelope now lives in `@ledger-lens/shared` (spec 0006) so
// the client validates the identical schema; re-exported here so existing imports
// (controller, service) keep resolving. `AccountIdSchema` stays below — it is a
// request-side path-param validator, shared by several controllers.
export { StatementIngestResponseSchema } from "@ledger-lens/shared";
export type { StatementIngestResponse } from "@ledger-lens/shared";

/** Path param: the owning account id. */
export const AccountIdSchema = z.string().uuid();
