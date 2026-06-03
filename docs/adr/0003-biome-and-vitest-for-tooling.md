# 0003. Biome for lint/format, Vitest for tests

- **Status:** Accepted
- **Date:** 2026-06-02

## Context
We want fast, low-config tooling that works uniformly across every workspace
package and is easy to enforce in pre-commit hooks and CI.

## Decision
Use **Biome** as the single lint + format tool, and **Vitest** as the test
runner. Husky + lint-staged run Biome on staged files; commitlint enforces
Conventional Commits.

## Alternatives considered
- **ESLint + Prettier** — the conventional NestJS default, but two tools, slower,
  and more config. We may add ESLint locally inside `apps/api` later if a
  Nest-specific rule is needed.
- **Jest** — heavier and slower than Vitest for an ESM/TS-first repo.

## Consequences
- Positive: one fast formatter/linter, near-zero config, consistent across the
  monorepo.
- Negative (accepted): Biome's lint rule set is younger than ESLint's; some niche
  rules may be missing.
