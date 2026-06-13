// The categorize response envelope now lives in `@ledger-lens/shared` (spec 0006)
// so the client validates the identical schema; re-exported here so existing
// imports (controller, service) keep resolving. This endpoint has no request-side
// schema of its own.
export { CategorizeResponseSchema } from "@ledger-lens/shared";
export type { CategorizeResponse } from "@ledger-lens/shared";
