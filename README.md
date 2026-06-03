# LedgerLens

An **AI-native, agentic financial analyst**. Upload bank/credit statements; an
agent extracts, categorises, reconciles, and answers natural-language questions
about your finances — with deterministic money math and a rigorous evaluation
harness behind every LLM feature.

> Portfolio project. Personal IP, synthetic data only. Built TypeScript-first to
> use the Claude **Agent SDK** and a custom **MCP server** as the core of the
> design, not as a bolt-on.

## Why it's built this way

The interesting engineering here is not "we called an LLM". It is:

- **A determinism-first boundary** (see [ADR-0004](docs/adr/0004-determinism-first-llm-boundary.md)).
  The model decides *what* to compute and explains results; pure functions
  compute the money. Wrong numbers are never acceptable in finance.
- **A custom MCP server** exposing typed domain tools the agent calls.
- **An eval harness** with regression tests for prompts, agent behaviour, and
  tool use — wired into CI as a gate.

## Stack

TypeScript (strict) · Next.js · NestJS · PostgreSQL · Claude API · Claude Agent
SDK · MCP · Zod · Vitest · Biome · Docker · Azure (Container Apps) · GitHub
Actions.

## Repo layout

```
apps/web            Next.js frontend
apps/api            NestJS backbone + Agent SDK orchestrator
packages/shared     shared types & Zod schemas
packages/mcp-server domain MCP server
packages/evals      eval harness + golden datasets
docs/adr            architecture decision records
docs/specs          feature specs (written before code)
```

## Getting started

Requirements: Node 22+, pnpm 9+, Docker.

```bash
pnpm install
cp .env.example .env          # PowerShell: copy .env.example .env
docker compose up -d postgres # local DB (Adminer on http://localhost:8080)
pnpm check                    # lint + typecheck + test
```

## Build phases

This repo is built in phases; each is a meaningful, reviewable increment.

- **Phase 0 — done.** Monorepo, strict tooling, AI-native config (`CLAUDE.md`,
  `.claude/` agents & commands), seed ADRs, Docker, CI skeleton.
- Phase 1 — domain core (NestJS + Drizzle + statement ingestion).
- Phase 2 — Claude API integration (structured extraction/categorisation).
- Phase 3 — custom MCP server.
- Phase 4 — agentic orchestration (Agent SDK).
- Phase 5 — eval harness + CI eval gate.
- Phase 6 — Next.js frontend with streaming agent UI.
- Phase 7 — Docker + Azure deploy + observability.
- Phase 8 — polish: ADR writeups, demo, eval report.

## AI-native workflow

This project is developed with Claude Code. Conventions live in
[`CLAUDE.md`](CLAUDE.md). Specs precede code (`/new-feature-spec`); big decisions
get an ADR (`/new-adr`); generated code is reviewed before merge (`/review`).
