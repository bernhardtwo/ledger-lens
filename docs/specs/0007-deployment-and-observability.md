# 0007. Deployment, infrastructure & observability (Phase 7)

- **Status:** Accepted
- **Date:** 2026-06-13
- **Phase:** 7
- **Builds on:** ADR-0002 (pnpm monorepo), ADR-0004 (determinism-first),
  ADR-0007 (MCP server over stdio), ADR-0008 (agent design + subprocess model),
  ADR-0010 (SSE streaming + the un-buffering gate), spec 0006 (web + same-origin
  proxy), and this phase's two ADRs: **ADR-0011** (Azure Container Apps topology —
  the authoritative home of the platform/ingress/SSE decisions) and **ADR-0012**
  (container image & monorepo packaging — the authoritative home of the
  build/base-image/native-binary decisions). This spec **summarises and links**
  those ADRs; it does not restate their decisions.

## Summary / Goal

Deploy the existing system — `apps/api` (NestJS + Agent SDK orchestrator) and
`apps/web` (Next.js) — to **Azure Container Apps**, reproducibly, cheaply, and with
the live agent stream intact, plus enough observability to see request latency and
the agent's cost/turns. Nothing about the application's behaviour changes: Phase 7
adds **no new LLM surface**, ships compiled JS instead of the dev `tsx` runtime, and
closes two tiny deterministic gaps (`GET /health`, TLS to managed Postgres). The
deliverables are two Dockerfiles, a Bicep template, an ACA Job for migrate+seed, a
manual-dispatch `deploy.yml`, App Insights wiring, and a runbook — behind one
hard verification gate: **the agent stream must reach the browser un-buffered
through the cloud ingress.**

## Determinism-vs-LLM decision (central)

| Unit of work | Kind | Rationale |
|---|---|---|
| Everything in Phase 7 | `deterministic` | Containerization, IaC, ingress, DB provisioning, secrets, telemetry, CI/CD are all pure infrastructure. **No LLM call is added or moved.** |
| The only model in the system | `unchanged` | Stays the Phase 4 agent behind `/ask` + `/ask/stream` (ADR-0008, ADR-0010). Deployment relays its events; it computes nothing. |
| `GET /health` | `deterministic` | Static liveness response; no DB, no LLM. |
| TLS to Postgres | `deterministic` | Connection-string config (`?sslmode=require`); no behaviour change. |

**Hard guarantee:** Phase 7 is a deterministic wrapper around an unchanged
application. The determinism boundary (ADR-0004) and the eval gate (ADR-0009) are
untouched — the eval keeps running in GitHub Actions against an ephemeral
testcontainers Postgres, **not** in the cloud.

## Decisions (1–9)

**1. Containerization → ADR-0012.** Two multi-stage, pnpm-workspace-aware images on
`node:22-slim` (Debian/glibc). The api compiles `api`+`mcp-server`+`db`+`shared` to
JS, runs `node dist/http/main.js`, and bundles the matching **glibc** `claude`
agent binary so the agent + MCP stdio subprocesses work inside the one container.
Web uses Next **standalone** output. Pruning via `pnpm deploy --prod`.

**2. Azure target → ADR-0011.** Azure Container Apps; **web external ingress, api
internal ingress**; scale-to-zero (`minReplicas: 0`) with `minReplicas: 1` on the
api as a demo-time lever.

**3. SSE behind ingress → ADR-0011.** Envoy, `transport: http`, no buffering, no
session affinity (one long-lived request per stream). **This is the headline
verification gate — see Acceptance below.**

**4. Postgres: Azure Database for PostgreSQL Flexible Server (managed).**
- **SKU:** Burstable **B1ms**, smallest storage (32 GB). Cheapest managed tier;
  data is synthetic and reproducible, so the modest tier is justified.
- **Cost posture:** **stopped between demos** (Flexible Server stops for up to 7
  days, auto-restarts). ~$16/mo running, ~$4/mo stopped (storage only).
- **TLS:** Flexible Server enforces it; `DATABASE_URL` carries `?sslmode=require`.
  **Action:** verify postgres.js honours `sslmode` from the URL; if not, add an
  explicit `ssl` option in `packages/db/src/client.ts` (a one-line, determinism-safe
  change).
- **Networking:** public endpoint + firewall rule allowing the ACA environment;
  VNet/private endpoint is deferred (synthetic data).
- **Migrate + seed:** an **ACA Job** (run-to-completion) reusing the **api image**,
  command `db:migrate && db:seed:demo` (both idempotent — `ON CONFLICT DO NOTHING`
  / `category IS NULL`), run post-deploy. The demo seed is the committed,
  reproducible world from `packages/db/src/demo-seed.ts`.

**5. Secrets/config: ACA secrets.** `ANTHROPIC_API_KEY` and `DATABASE_URL` are
stored as Container App secrets and surfaced as `secretRef` env vars on the **api**
(web gets neither). The existing code propagates them correctly to the child
processes (`buildAskOptions` → agent; `mcpChildEnv` → MCP child, key dropped), so
**no app change** is needed beyond setting the two env vars. `API_BASE_URL` on web
points at the api's internal ACA FQDN. **Upgrade path (deferred):** Key Vault
references via managed identity.

**6. Observability: Azure Monitor OpenTelemetry → Application Insights.**
- **Request traces:** auto-instrumented HTTP latency/status on the api.
- **Agent-run span:** one custom span per `ask` carrying `model`, `turns`, `tools`,
  `costUsd` — the values the api **already logs** (`agent-sdk-client.ts`
  `ask account=… cost_usd=…`). Cost stays server-side only (ADR-0008 §6); never on
  the wire.
- **Logs:** ACA streams the existing structured console logs to the environment's
  Log Analytics workspace for free.
- **Honest limit (deferred):** MCP tool calls run inside the `claude`/MCP
  **subprocesses**, which the api's OTel cannot span. We may emit a log/event per
  `tool_call` from the SSE event mapper, but cross-process tracing into the binary
  and web→api trace propagation are out of scope.

**7. CI/CD: GitHub Actions + OIDC + Bicep.** A new **`deploy.yml`**, separate from
`ci.yml`/`eval.yml`, **manual dispatch** (optionally on push to `main`), gated on
green CI:
1. `azure/login` via **workload-identity federation** (OIDC; no stored service
   principal secret).
2. `docker buildx` both images → push to **ACR**, tagged by commit SHA.
3. `az deployment group create` against the **Bicep** template (IaC source of
   truth), then roll the new image tag onto the two Container Apps.
4. Run the migrate+seed **ACA Job** when the schema changed.

`ci.yml` (lint/typecheck/test/integration) and `eval.yml` (manual+weekly,
testcontainers) are **unchanged**.

**8. Cost control.** Scale-to-zero both apps; ACR **Basic**; Postgres B1ms stopped
between demos; short log retention.

| Resource | Idle | Notes |
|---|---|---|
| ACA web + api | ~$0 | scale-to-zero, within ACA monthly free grant |
| ACR Basic | ~$5/mo | one registry, both images |
| Postgres B1ms (+32 GB) | ~$16/mo running · **~$4 stopped** | dominant idle cost; stop between demos |
| Log Analytics / App Insights | minimal | low ingestion + short retention |
| Anthropic | $0 idle | capped $25/mo workspace |
| **Total** | **~$20/mo running · ~$9/mo with PG stopped** | + tokens (capped) when active |

**9. Scope cut.**

*Ships:* two Dockerfiles (ADR-0012); Bicep for ACR + ACA env + Log Analytics + two
Container Apps + Postgres Flexible Server + secrets; the migrate+seed ACA Job;
`deploy.yml` (OIDC, build/push, Bicep deploy); App Insights via Azure Monitor OTel
(request traces + the agent-run span); `GET /health` + TLS to Postgres; the cloud
SSE verification; a runbook.

*Defers:* custom domain + managed cert (use the default `*.azurecontainerapps.io`);
Key Vault + managed identity; autoscaling tuning beyond scale-to-zero; running the
**eval in-cloud** (stays in GitHub Actions / testcontainers — ADR-0009 untouched);
per-tool-call tracing into the `claude` subprocess and web→api trace propagation;
VNet/private Postgres; blue/green, multi-env, automated rollback; web CDN/static
optimization.

## Prep changes (small, deterministic, before infra)

1. **`GET /health`** on the api — a static `200` liveness target for the ACA probe
   (no DB/LLM). A trivial controller; covered by one unit test.
2. **TLS to Postgres** — append `?sslmode=require` to the cloud `DATABASE_URL`;
   verify postgres.js reads it, else add `ssl` in `client.ts`.
3. **Emit tsconfigs + `mcp-launch.ts` prod branch** (ADR-0012) — make the workspace
   compile to runnable `dist/` and spawn the compiled MCP entry with plain `node`.
4. **`next.config.ts` `output: "standalone"`** (ADR-0012) for the web image.

## Acceptance / verification gates

- **SSE un-buffered through the cloud ingress (headline).** `curl -N` the **deployed
  web** URL's `/api/accounts/:id/ask/stream` and confirm `tool_call` /
  `tool_result` / `answer` / `done` frames arrive **incrementally** (timestamped),
  end-to-end (external-Envoy → Next proxy → internal-Envoy). On failure, adopt the
  ADR-0010 §6 fallback. This is the cloud analog of the local proxy gate and the
  go/no-go for the phase.
- **Cold path works:** deploy from a cold (`minReplicas: 0`) state, hit web, pick an
  account (`GET /accounts`), upload a CSV, categorize, and ask a question that
  triggers the agent → MCP → Postgres tree end-to-end.
- **Determinism intact:** the existing integration tests and the eval (run from CI,
  unchanged) stay green; no money/total is computed anywhere in the deploy path.
- **Secrets isolation:** the api process has `ANTHROPIC_API_KEY` + `DATABASE_URL`;
  the MCP child has `DATABASE_URL` but **not** the key (already enforced by
  `mcpChildEnv`); web has neither.
- **Cost:** confirm idle Container Apps scale to zero; confirm the cost posture
  matches the table (PG stoppable).

## Out of scope

Everything under "Defers" in decision 9. Phase 8 (polish/demo/report) may pick up
the deferred items (custom domain, Key Vault, richer tracing) as warranted.
