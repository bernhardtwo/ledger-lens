# Docs index

The decision records and specs that drive this repo. The workflow is **spec before code,
ADR before big decisions** (see [`../CLAUDE.md`](../CLAUDE.md)) — so these document the
*why*, written before the code they describe. **ADRs** capture decisions + alternatives +
consequences; **specs** capture a feature's plan, each stating its determinism-vs-LLM call
explicitly. The curated [eval report](eval-report.md) and the deploy
[runbook](../infra/RUNBOOK.md) sit alongside.

## The thesis (read this first)

- [ADR-0004 — Determinism-first LLM boundary](adr/0004-determinism-first-llm-boundary.md)
  — the rule that shapes everything: reach for an LLM only where it earns its place; money
  math and validation must be deterministic code.

## By phase

### Phase 0 — scaffold & conventions
- [ADR-0001 — Record architecture decisions](adr/0001-record-architecture-decisions.md) — adopt ADRs.
- [ADR-0002 — TypeScript monorepo with pnpm workspaces](adr/0002-typescript-monorepo-with-pnpm-workspaces.md)
- [ADR-0003 — Biome + Vitest for tooling](adr/0003-biome-and-vitest-for-tooling.md)

### Phase 1 — domain core & ingestion
- [ADR-0005 — Money & currency representation](adr/0005-money-and-currency-representation.md) — minor-unit integers, ISO-4217, no floats.
- [spec 0001 — Domain core & CSV ingestion](specs/0001-domain-core-and-csv-ingestion.md)

### Phase 2 — categorisation
- [ADR-0006 — LLM categorisation design](adr/0006-llm-categorization-design.md) — closed taxonomy, forced tool-use + Zod, deterministic fallback.
- [spec 0002 — Transaction categorization](specs/0002-transaction-categorization.md)

### Phase 3 — MCP server
- [ADR-0007 — Domain MCP server](adr/0007-domain-mcp-server.md) — read-only typed tools over stdio; tool money carries a deterministic `decimal` (§2a).
- [spec 0003 — Domain MCP server](specs/0003-domain-mcp-server.md)

### Phase 4 — agentic Q&A
- [ADR-0008 — Q&A agent over MCP tools](adr/0008-qa-agent-over-mcp-tools.md) — Agent SDK loop, code-enforced account scoping, model decision (§5).
- [spec 0004 — QA agent over MCP tools](specs/0004-qa-agent-over-mcp-tools.md)

### Phase 5 — evaluation
- [ADR-0009 — Eval harness & CI eval gate](adr/0009-eval-harness-and-ci-eval-gate.md) — the gate; ephemeral testcontainers Postgres; the two eval-surfaced bugs (§7).
- [spec 0005 — Evaluation harness](specs/0005-evaluation-harness.md) · curated [eval report](eval-report.md)

### Phase 6 — web frontend
- [ADR-0010 — Streaming agent events over SSE](adr/0010-streaming-agent-events-over-sse.md) — POST-SSE `AgentEvent` contract; the un-buffering gate + fallback (§6).
- [spec 0006 — Web frontend](specs/0006-web-frontend.md)

### Phase 7 — deployment & observability
- [ADR-0011 — Azure Container Apps deployment topology](adr/0011-azure-container-apps-deployment-topology.md) — web external / api internal; the cloud SSE gate.
- [ADR-0012 — Container image & monorepo packaging](adr/0012-container-image-and-monorepo-packaging.md) — glibc multi-stage images; the agent/MCP subprocess constraint.
- [ADR-0013 — Observability: OpenTelemetry → App Insights](adr/0013-observability-opentelemetry-to-app-insights.md) — agent + per-tool spans; managed-identity ACR pull.
- [spec 0007 — Deployment, infrastructure & observability](specs/0007-deployment-and-observability.md) · ops [runbook](../infra/RUNBOOK.md)

## Templates

- [ADR template](adr/template.md) — used by `/new-adr`.
