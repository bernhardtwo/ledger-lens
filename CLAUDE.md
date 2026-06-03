# LedgerLens — Project Memory

> Always-on context for Claude Code. Keep it short, current, and honest.
> If a convention here is wrong, fix the file in the same PR as the code.

## What this is

LedgerLens is an **AI-native, agentic financial analyst**. A user uploads bank/
credit statements (PDF/CSV); the system extracts, categorises, reconciles, and
answers natural-language questions about their finances. It is a portfolio
project demonstrating production-grade agentic engineering, not a real product.

This is **personal IP** built with **synthetic data only**. It shares no code
with any employer's codebase.

## The one rule that shapes everything: determinism first

Reach for an LLM only where it earns its place (unstructured extraction, natural
language, multi-step reasoning). Everything that can be deterministic **must** be
deterministic — money math, reconciliation arithmetic, validation. See
`docs/adr/0004-determinism-first-llm-boundary.md`.

Before adding an LLM call, ask: *could a pure function do this reliably?* If yes,
write the function. The judgement of when **not** to use an LLM is a core signal
of this project.

## Workflow (non-negotiable)

1. **Spec before code.** For any feature spanning more than one file, write a
   short spec first (`/new-feature-spec`). It must state the determinism-vs-LLM
   decision explicitly.
2. **ADR before big decisions.** Stack, boundaries, infra → record an ADR
   (`/new-adr`) before implementing.
3. **Review AI-generated code critically.** Never merge generated code you have
   not read line by line. Use the `code-reviewer` subagent; treat its output as
   input, not gospel.
4. **Verify before commit.** Run `pnpm check` (lint + typecheck + test). The
   commit-msg hook enforces Conventional Commits.

## Commit conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- English only — this repo is portfolio evidence for an English-speaking audience.
- Prefer small, descriptive, additive commits. The history is part of the
  portfolio: it should read as a clear AI-native workflow. Avoid rewriting
  shared history.

## Monorepo layout

```
apps/web          Next.js (App Router) frontend          [Phase 1/6]
apps/api          NestJS backbone + Agent SDK orchestrator [Phase 1/4]
packages/shared   shared types & Zod schemas
packages/mcp-server  domain MCP server                    [Phase 3]
packages/evals    eval harness + golden datasets          [Phase 5]
docs/adr          architecture decision records
docs/specs        feature specs (written before code)
```

## Stack

- **Language:** TypeScript (strict, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`). TS is our "modern OOP language".
- **Frontend:** Next.js (App Router). **Backend:** NestJS (DI, OOP services).
- **DB:** PostgreSQL (+ Drizzle, decided in Phase 1).
- **LLM:** Claude API (`@anthropic-ai/sdk`) for single calls; **Claude Agent SDK
  (TS)** for the agent loop; **MCP TS SDK** for the domain server.
- **Validation:** Zod at every trust boundary (API in/out, LLM structured output).
- **Tests:** Vitest (+ Supertest for API, a versioned Postman collection).
- **Tooling:** Biome (lint + format), Husky + lint-staged + commitlint.
- **Infra:** Docker + docker-compose (local Postgres); Azure Container Apps + CI
  via GitHub Actions (Phase 7).

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Lint | `pnpm lint` / fix: `pnpm lint:fix` |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` (watch: `pnpm test:watch`) |
| All checks | `pnpm check` |
| Local DB | `docker compose up -d postgres` (Adminer on `:8080`) |

**Environment note (firewalker / Windows / PowerShell):** all npm scripts are
cross-platform (no Unix-only shell). Husky hooks run through Git's bundled bash,
so they work on Windows. If you add scripts, keep them cross-platform — no bare
`rm`/`cp`; use Node-based tools (`rimraf`, etc.).

## Secrets

`ANTHROPIC_API_KEY` is **server-side only** — never import it into `apps/web`
client code. Copy `.env.example` to `.env` (gitignored).

## Subagents available (`.claude/agents/`)

- `spec-writer` — turn a request into a spec (incl. determinism-vs-LLM call).
- `code-reviewer` — critical review of (especially AI-generated) code.
- `adr-writer` — draft an ADR from a decision context.

## Phase status

Phase 0 (this scaffold) is **done**: monorepo, tooling, AI-native config, ADRs,
CI skeleton. Next: Phase 1 — domain core (NestJS + Drizzle + ingestion).
