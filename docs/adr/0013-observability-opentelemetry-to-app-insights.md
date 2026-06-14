# 0013. Observability: OpenTelemetry → Azure Monitor / Application Insights

- **Status:** Accepted
- **Date:** 2026-06-14

## Context

Phase 7 / step **2d** adds observability to the deployed `apps/api`. Spec 0007 §6
already chose the stack (Azure Monitor OpenTelemetry → Application Insights) and
committed to **one agent-run span** carrying `model/turns/tools/costUsd`; §9
**deferred** "per-tool-call tracing into the `claude` subprocess." This ADR
formalises the stack decision and records one deliberate **widening** of that
deferral — in-process per-tool-call spans — plus the small ACR hardening bundled
into the same step.

Forces:

- **The AI-native money shot.** The headline signal is *seeing the agent work*: each
  MCP tool-call as a span with its name, ok/error, and latency, under one agent-run
  span. This is the differentiating observability for an agentic system.
- **Proportionality.** Observability balloons easily (dashboards, RUM, alerting). 2d
  must stay tight — instrument the agent path, defer the rest.
- **Determinism-first (ADR-0004).** Instrumentation adds **no LLM surface**. It reads
  signals the api already computes (`total_cost_usd`, `num_turns`, tool names) and
  exports them. It must not change `/ask` behaviour.
- **The 2c SSE gate must not regress.** The single biggest risk of 2d is an HTTP
  instrumentation that re-introduces response buffering. Telemetry export must be
  async and never awaited in the request path.
- **Cost stays server-side (ADR-0008 §6).** Cost is a span attribute / metric only,
  never on the SSE/HTTP wire.
- **The tool runs in a subprocess.** MCP tool execution happens inside the spawned
  `claude` binary → `node` MCP child (ADR-0007/0008). The api's in-process OTel
  cannot span *inside* that subprocess; but it *can* observe each `tool_use` /
  `tool_result` SDK message as it crosses the `query()` loop.
- **Portfolio relevance.** Evidence for an Azure-heavy role: current, idiomatic,
  vendor-neutral instrumentation, not a legacy SDK.

## Decision

**1. Stack — Azure Monitor OpenTelemetry distro, in-app.** `@azure/monitor-opentelemetry`
(`useAzureMonitor`) exporting to a **workspace-based** Application Insights on the
**existing** `ledgerlens-law` Log Analytics workspace. OTel is the instrumentation
API; App Insights is the backend (transaction search, Application Map, custom
metrics). Not the ACA managed OTel collector (it cannot emit our custom spans).

**2. Init — `node --import` before Nest, no-op without the env var.** A dedicated
`apps/api/src/observability/instrumentation.ts` is loaded via `node --import
./dist/observability/instrumentation.js dist/http/main.js` (the api Dockerfile CMD)
so `http`/`express` are patched before they load. It calls `useAzureMonitor` **only
if `APPLICATIONINSIGHTS_CONNECTION_STRING` is set**; absent → it does nothing, so
local dev, the unit/integration suites, and the eval run with zero telemetry and no
behaviour change. The application code uses `@opentelemetry/api` only, which returns
**no-op** tracers/meters when no SDK is registered.

**3. Spans.**
- **`agent.ask`** — one span per `/ask` and `/ask/stream`, opened at the shared
  `AgentSdkQaAgent` seam (the only place `query()` is called). Attributes set on the
  terminal `result` message: `agent.model`, `agent.turns`, `agent.tool_count`,
  `agent.cost_usd` (server-side), `agent.stop_reason`, `agent.streaming`.
- **`agent.tool <name>`** — a child span per MCP tool-call, synthesised **in-process**
  from the live SDK message stream: started when a `tool_use` block is seen (keyed by
  `block.id`), ended when the matching `tool_result` arrives (`tool_use_id`).
  Attributes `tool.name`, `tool.ok`. **This widens spec 0007 §6's deferral** (see
  Boundary).
- **HTTP request spans** — auto-instrumented by the distro.

**4. Metrics.** `agent.cost_usd` and `agent.turns` recorded as OTel metrics (→ App
Insights `customMetrics`) for aggregation/KQL, in addition to the span attributes.

**5. Errors.** The global `HttpExceptionsFilter` and the SSE terminal-error seam
record the exception on the active span (`recordException` + ERROR status).

**6. Boundary / honest caveats.**
- **Per-tool span latency is the orchestrator's api-observed call→result round-trip**
  (`tool_use` message seen → `tool_result` message seen). It includes the
  agent-binary + MCP-stdio round-trip; it is **not** the in-DB query time. True
  cross-process tracing **into** the `claude`/MCP subprocess, and **web→api** trace
  propagation, stay **deferred**.
- Cost is a span attribute / metric only; never on the wire.
- Export is async (batch); telemetry is **never awaited** in the request path, so the
  2c SSE un-buffering gate is preserved (re-verified after deploy).

**7. Hardening bundled into 2d — managed identity for ACR pull.** A **user-assigned**
managed identity is granted `AcrPull` on the registry and attached to both Container
Apps and the migrate Job; the `registries` block authenticates by `identity` instead
of admin credentials; **ACR admin user is disabled**; `deploy.sh`'s local-build push
switches to `az acr login` (AAD token). Net: **zero stored registry passwords**. Key
Vault for the app secrets (`database-url`, `anthropic-api-key`,
`appinsights-connection-string`) remains the deferred upgrade path (ADR-0011).

## Alternatives considered

- **Classic Application Insights Node SDK (`applicationinsights`)** — maintenance mode;
  Microsoft now recommends the OTel distro; non-portable instrumentation. Rejected.
- **ACA managed OTel collector** — captures platform/auto signals but cannot emit the
  custom `agent.ask` / `agent.tool` spans that are the whole point. Rejected for 2d.
- **Vanilla OTel SDK + OTLP exporter** — more wiring for the same destination; the
  Azure distro bundles the exporter + sane defaults. Rejected.
- **True cross-process tracing into the MCP/`claude` subprocess** (propagate context
  via env, instrument the MCP server) — higher complexity against an opaque binary;
  the in-process tool spans deliver most of the signal at a fraction of the cost.
  Deferred.
- **Key Vault now** — bigger change, low marginal benefit on synthetic data. Deferred.

## Consequences

- **Positive:** AI-native traces (agent run + per-tool spans + cost metric) in App
  Insights from one shared seam with minimal code; portable OTel instrumentation;
  **zero stored registry passwords**; no determinism/behaviour change; a clean no-op
  locally and in CI.
- **Negative (accepted):** tool-span latency is api-observed, not in-DB (documented);
  no distributed trace across the subprocess boundary or web→api; user-assigned MI +
  `AcrPull` adds RBAC-propagation timing (a first cold image pull may retry); the
  distro's HTTP instrumentation must be verified not to buffer SSE — covered by
  re-running the 2c gate.
- **Follow-ups (deferred):** Key Vault-backed secrets; web/RUM client telemetry;
  alerting/action groups; cross-process + web→api tracing; dashboards/workbooks beyond
  saved KQL queries in the runbook.
