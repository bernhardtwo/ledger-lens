/**
 * Typed fetch client. The browser calls same-origin `/api/*` (Next rewrites it to
 * the API, spec 0006), every response is validated through a shared Zod schema at
 * the client boundary, and both server error-body shapes are normalised to one
 * `ApiError` before the UI sees them.
 */
import type { ZodType } from "zod";
import { type Account, AccountsResponseSchema } from "./contracts";

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

async function getJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Accept: "application/json" } });
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
    // distinct failure, NOT "unreachable" (which would misdiagnose it as a network outage).
    throw new ApiError(res.status, "unexpected response shape", "invalid-response");
  }
  return parsed.data;
}

/** `GET /accounts` — the demo accounts for the no-auth picker. */
export async function listAccounts(): Promise<Account[]> {
  const page = await getJson("/api/accounts", AccountsResponseSchema);
  return page.accounts;
}
