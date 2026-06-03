# 0002. TypeScript monorepo with pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-06-02

## Context
The job this project targets explicitly names the **Claude Agent SDK**, which is
available only in TypeScript and Python. We want frontend, backend, the domain
MCP server, and the eval harness to share types and a single toolchain. The
author is most productive in the TS/Next.js ecosystem.

## Decision
Single TypeScript monorepo managed with **pnpm workspaces**: `apps/*` and
`packages/*`. TypeScript runs in strict mode (`exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`) and serves as the project's "modern OOP language".

## Alternatives considered
- **.NET / C# backend** — matches AltaML hints (xUnit, Azure) more literally, but
  the Agent SDK does not exist in C#, so we would lose first-class use of the very
  tool the role names. Rejected for this project.
- **Python backend** — strong for ML, but splits the stack across two languages
  and loses end-to-end type sharing with the Next.js frontend.
- **Polyrepo** — more isolation, but heavier coordination and no shared types.

## Consequences
- Positive: one language end-to-end; shared Zod schemas; first-class Agent SDK +
  MCP TS SDK; fast installs and strict typing.
- Negative (accepted): less literal match to AltaML's .NET/Azure hints (mitigated
  by deploying to Azure and shipping a Postman collection).
