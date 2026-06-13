/**
 * Typed fetch client. The browser calls same-origin `/api/*` (Next rewrites it to
 * the API, spec 0006), every response is validated through a shared Zod schema at
 * the client boundary, and both server error-body shapes are normalised to one
 * `ApiError` before the UI sees them.
 */
import type { TypeOf, ZodTypeAny } from "zod";
import {
  type Account,
  AccountsResponseSchema,
  type CategorizeResponse,
  CategorizeResponseSchema,
  type StatementIngestResponse,
  StatementIngestResponseSchema,
  type TransactionsPageResponse,
  TransactionsPageResponseSchema,
} from "./contracts";

/** A normalised API failure. `status === 0` means the network/proxy was unreachable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly signature?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Coerce an unknown thrown value to an `ApiError` (non-`ApiError` ⇒ unexpected). */
export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, "Unexpected error");
}

/**
 * The API emits two error-body shapes: `{ error, message, signature? }` (domain
 * errors) and `{ statusCode, message, error? }` (Nest `HttpException`). Read both.
 */
function normalizeError(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null) {
    const b = body as Record<string, unknown>;
    const message = typeof b.message === "string" ? b.message : `request failed (${status})`;
    const code = typeof b.error === "string" ? b.error : undefined;
    const signature = typeof b.signature === "string" ? b.signature : undefined;
    return new ApiError(status, message, code, signature);
  }
  return new ApiError(status, `request failed (${status})`);
}

// Generic over the schema (not its output T) so a schema whose input differs from
// its output — e.g. the branded `IsoDate` on `transactionDate` — keeps its OUTPUT type.
async function request<S extends ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<TypeOf<S>> {
  let res: Response;
  try {
    // No Content-Type set: GET/POST-no-body don't need one, and a FormData body must
    // be left to the browser so it sets the multipart boundary.
    res = await fetch(path, { ...init, headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "API unreachable");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw normalizeError(res.status, body);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Server reachable but the contract broke (drift / unexpected payload) — a
    // distinct failure, NOT "unreachable" (which would misdiagnose a network outage).
    throw new ApiError(res.status, "unexpected response shape", "invalid-response");
  }
  return parsed.data;
}

/** `GET /accounts` — the demo accounts for the no-auth picker. */
export async function listAccounts(): Promise<Account[]> {
  const page = await request("/api/accounts", AccountsResponseSchema);
  return page.accounts;
}

/** Keyset page size; the API clamps to [1, 200] and defaults to 50. */
export const TRANSACTIONS_PAGE_LIMIT = 50;

/** `GET /accounts/:id/transactions` — one keyset page (forward-only). */
export function listTransactions(
  accountId: string,
  cursor?: string,
): Promise<TransactionsPageResponse> {
  const params = new URLSearchParams({ limit: String(TRANSACTIONS_PAGE_LIMIT) });
  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }
  return request(
    `/api/accounts/${accountId}/transactions?${params.toString()}`,
    TransactionsPageResponseSchema,
  );
}

/** `POST /accounts/:id/statements` — multipart CSV upload (field `file`). */
export function uploadStatement(accountId: string, file: File): Promise<StatementIngestResponse> {
  const form = new FormData();
  form.append("file", file);
  return request(`/api/accounts/${accountId}/statements`, StatementIngestResponseSchema, {
    method: "POST",
    body: form,
  });
}

/** `POST /accounts/:id/categorize` — idempotent; categorises NULL rows only. */
export function categorizeAccount(accountId: string): Promise<CategorizeResponse> {
  return request(`/api/accounts/${accountId}/categorize`, CategorizeResponseSchema, {
    method: "POST",
  });
}
