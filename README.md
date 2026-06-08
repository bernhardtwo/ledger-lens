# LedgerLens

An **AI-native, agentic financial analyst**. Upload bank/credit statements; an
agent ingests, categorises, and answers natural-language questions about your
finances — with deterministic money math and a rigorous evaluation harness
behind every LLM feature.

> Portfolio project. Personal IP, synthetic data only. Built TypeScript-first to
> use the Claude **Agent SDK** and a custom **MCP server** as the core of the
> design, not as a bolt-on.

## Why it's built this way

The interesting engineering here is not "we called an LLM". It is:

- **A determinism-first boundary** (see [ADR-0004](docs/adr/0004-determinism-first-llm-boundary.md)).
  The model decides *what* to compute and explains results; pure functions
  compute the money. Wrong numbers are never acceptable in finance.
- **A custom MCP server** exposing typed domain tools the agent calls.
- **An eval harness** (Phase 5) to gate prompts, agent behaviour, and tool use in
  CI — so every LLM feature is measured, not hoped for.

## Stack

TypeScript (strict) · Next.js · NestJS · PostgreSQL · Claude API · Claude Agent
SDK · MCP · Zod · Vitest · Biome · Docker · Azure (Container Apps) · GitHub
Actions.

## Repo layout

```
apps/api            NestJS backbone + Agent SDK orchestrator + categorisation
packages/shared     shared domain types & Zod schemas (Money, taxonomy)
packages/db         Drizzle schema, migrations, repository
packages/mcp-server domain MCP server (read-only tools)
docs/adr            architecture decision records
docs/specs          feature specs (written before code)

apps/web            Next.js frontend             (planned, Phase 6)
packages/evals      eval harness + golden data   (planned, Phase 5)
```

## Getting started

Requirements: Node 22+, pnpm 9+, Docker.

```bash
pnpm install
cp .env.example .env          # PowerShell: copy .env.example .env
docker compose up -d postgres # local DB
pnpm check                    # lint + typecheck + unit tests (no Docker)
pnpm test:integration         # integration tests (testcontainers; needs Docker)
```

## Build phases

This repo is built in phases; each is a meaningful, reviewable increment.

- **Phase 0 — done.** Monorepo, strict tooling, AI-native config (`CLAUDE.md`,
  `.claude/` agents & commands), seed ADRs, Docker, CI skeleton.
- **Phase 1 — done.** Domain core: Money value object + ISO-4217 registry, CSV
  statement ingestion (mapping profiles, idempotent persistence via Drizzle),
  HTTP API (upload + transactions).
- **Phase 2 — done.** LLM transaction categorisation: closed taxonomy, Haiku via
  forced tool-use + Zod, determinism-first fallback.
- **Phase 3 — done.** Custom domain MCP server: five read-only tools over a
  shared `@ledger-lens/db` package (stdio transport).
- **Phase 4 — done.** Agentic Q&A orchestration: Agent SDK + Haiku,
  MCP-over-stdio, code-enforced account scoping.
- Phase 5 — eval harness + CI eval gate.
- Phase 6 — Next.js frontend with streaming agent UI.
- Phase 7 — Docker + Azure deploy + observability.
- Phase 8 — polish: ADR writeups, demo, eval report.

## AI-native workflow

This project is developed with Claude Code. Conventions live in
[`CLAUDE.md`](CLAUDE.md). Specs precede code (`/new-feature-spec`); big decisions
get an ADR (`/new-adr`); generated code is reviewed before merge (`/review`).

## License

Licensed under the Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).