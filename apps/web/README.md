# @ledger-lens/web

The LedgerLens frontend — Next.js (App Router). See `docs/specs/0006-web-frontend.md`.

A no-auth demo over the seed accounts: pick an account, import a CSV statement,
browse the keyset transactions table, categorize uncategorized rows, and ask the
Q&A agent natural-language questions — its tool calls stream in live. Depends only
on `@ledger-lens/shared` (+ next / react / zod) — never `@ledger-lens/db`.

- **Proxy:** `next.config.ts` rewrites `/api/*` → `API_BASE_URL` (server-side env,
  not `NEXT_PUBLIC_`), so the browser only ever calls same-origin Next and the API
  needs no CORS change. The agent SSE endpoint streams **un-buffered** through it.
- **Streaming chat:** each question is an independent `POST .../ask/stream` read via
  `fetch` + `ReadableStream` (a POST body rules out `EventSource`); a pure reducer
  folds the `AgentEvent` stream into the live turn (ADR-0010).
- **Determinism-first:** money renders only via the shared `moneyDtoToDecimalString`
  (`lib/money.tsx` → pure `lib/money-format.ts`) — never `Number()` / `÷100`. The
  tool trail shows only figure-free inputs; every amount lives in the answer text.
- **Consistency:** the surfaces share one error banner (`describeApiError` +
  `ApiErrorBanner`), one `Loading` / `EmptyState`, and one `buttonClassName`.
- **Run (from the repo root):** `pnpm dev` brings up Postgres + api + web together.
- **Tests:** Vitest — pure logic (SSE parser, turn reducer, money + error mapping)
  in the `node` project; jsdom/RTL component renders in the `web` project.
