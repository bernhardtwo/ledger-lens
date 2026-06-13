# @ledger-lens/web

The LedgerLens frontend — Next.js (App Router). See `docs/specs/0006-web-frontend.md`.

**Chunk B (here):** the lean scaffold + a no-auth demo **account picker** that reads
`GET /accounts` from the browser through a same-origin proxy. Depends only on
`@ledger-lens/shared` (+ next / react / zod) — never `@ledger-lens/db`.

- **Proxy:** `next.config.ts` rewrites `/api/*` → `API_BASE_URL` (server-side env,
  not `NEXT_PUBLIC_`), so the browser only ever calls same-origin Next and the API
  needs no CORS change. Verified: the agent SSE endpoint streams **un-buffered**
  through this proxy.
- **Determinism-first:** money renders only via the shared `moneyDtoToDecimalString`
  (`lib/money.tsx` → pure `lib/money-format.ts`) — never `Number()` / `÷100`.
- **Run (from the repo root):** `pnpm dev` brings up Postgres + api + web together.

**Deferred to Chunk C:** the statement upload, transactions table, and streaming
chat surfaces, plus their jsdom/RTL component-render tests.
