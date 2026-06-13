# 0011. Deploy to Azure Container Apps (web external, api internal)

- **Status:** Accepted
- **Date:** 2026-06-13

## Context

Phase 7 takes the two deployable services — `apps/api` (NestJS + the Claude Agent
SDK orchestrator) and `apps/web` (Next.js) — to the cloud. The other workspace
packages (`shared`, `db`, `mcp-server`, `evals`) are dependencies, not separately
deployed; the image-build side of that is **ADR-0012**, the operational detail
(Postgres, secrets, observability, CI/CD, cost) is **spec 0007**. This ADR records
the **platform and request topology** only.

Forces at play:

- **Two long-running containers**, not functions. The api holds a process tree at
  request time: `node` (Nest) → spawns the native `claude` agent binary → which
  spawns the `node` MCP server over stdio (ADR-0007, ADR-0008). That rules out a
  pure FaaS target.
- **Scale-to-zero is the cost lever.** This is a portfolio demo with a synthetic
  dataset and a $25/mo Anthropic cap (CLAUDE.md: "keep it cheap"). Idle compute
  must approach $0.
- **SSE must survive the cloud ingress un-buffered.** The headline agentic UX is
  the live "show your work" stream (ADR-0010). Locally we gated that the agent's
  events stream through the Next dev proxy un-buffered; the cloud ingress is the
  **direct analog of that gate** and must pass the same way.
- **The api need not be public.** The browser only ever calls same-origin Next,
  which proxies `/api/*` to the api (spec 0006, `next.config.ts` rewrites). So the
  api can stay private to the environment.
- **Portfolio relevance.** This is evidence for an Azure-heavy role (AltaML), so
  the choice should read as a current, idiomatic Azure-native container story, not
  a lowest-common-denominator one.

Determinism-first (ADR-0004) is unaffected: deployment adds **no** new LLM surface.
The only model in the system stays the Phase 4 agent behind `/ask` + `/ask/stream`.

## Decision

**1. Azure Container Apps (ACA) is the platform.** Both services run as Container
Apps in one ACA environment (one Log Analytics workspace, one ACR feeding both).
ACA gives us, out of the box, exactly the four forces above: native
**scale-to-zero** (KEDA), a managed **Envoy ingress** with an internal/external
split, run-to-completion **Jobs** (used for migrate + seed, spec 0007), revisions,
and built-in secrets + Log Analytics.

**2. Ingress topology: web external, api internal.**

```
Internet ──HTTPS──▶ web (external ingress)
                      │  Next rewrites proxy (server-side, same-origin)
                      └──internal ACA FQDN──▶ api (internal ingress)
                                                 └─ TLS ─▶ Postgres Flexible Server
```

The api is **never publicly reachable**; the only public surface is web. This is
the cloud form of the local same-origin-proxy design (spec 0006) and means **no
API CORS change** is needed. The Next rewrite `destination` becomes the api's
internal ACA FQDN, injected via the existing `API_BASE_URL` env var.

**3. Scale-to-zero, with an honest cold-start caveat.** Both apps default to
`minReplicas: 0`. The api image is binary-dominated (~600 MB; ADR-0012), so a
scale-from-zero pull adds first-request latency. Accepted for a demo; the
documented lever is to set the **api** `minReplicas: 1` only for the duration of a
live demo. HTTP-concurrency autoscaling stays at ACA defaults (tuning is deferred,
spec 0007).

**4. SSE through Envoy.** Ingress `transport` stays **http** (auto), **not**
http2/grpc — the stream is HTTP/1.1 `text/event-stream`. ACA's Envoy does not
buffer streaming responses by default; the app already sends `Cache-Control:
no-transform` and `X-Accel-Buffering: no` and flushes headers on the first event
(`ask-stream.service.ts`). Because each stream is **one** long-lived request pinned
to a single replica for its lifetime, **session affinity is not required**. This
carries one empirical risk, treated as a gate not an assumption:

> **Cloud SSE gate (spec 0007 acceptance):** `curl -N` the **deployed web** URL's
> `/api/accounts/:id/ask/stream` and confirm `tool_call` / `tool_result` / `answer`
> / `done` frames arrive **incrementally** (timestamped), end-to-end through
> external-Envoy → Next proxy → internal-Envoy. If any hop buffers, adopt the
> ADR-0010 §6 fallback (a Next Route Handler that pipes with buffering off, or
> direct CORS) — no new decision required.

## Alternatives considered

- **Azure App Service (containers)** — no true scale-to-zero (a Basic/Standard plan
  bills a minimum of one always-on instance), and the internal/external two-app
  split is clumsier than ACA's. Fails the headline cost lever.
- **AKS** — full Kubernetes for two containers is over-engineered: we would own a
  control plane, node pools, ingress controller, and cert/secret plumbing for a
  demo. Higher cost floor and ops surface, weaker signal-to-effort.
- **One combined container (web + api)** — couples two runtimes (Next server + Nest
  + the agent binary) and two ports behind one ingress, breaks independent scaling,
  and muddies the "two deployables" story. Rejected.
- **Public api ingress** — exposes the agent endpoint to the internet for no
  benefit (the browser never calls it directly). Rejected on least-exposure.
- **Native `EventSource` / WebSocket transport instead of POST-SSE** — already
  settled in ADR-0010; nothing about the cloud changes that.

## Consequences

- **Positive:** scale-to-zero idle ≈ $0 compute; api kept off the public internet
  with zero CORS work; one managed ingress + one Log Analytics + one ACR; a clean,
  current Azure-native stack as portfolio evidence; the SSE design carries over
  unchanged behind a single explicit verification gate.
- **Negative (accepted):** the binary-heavy api image makes scale-from-zero
  cold-starts slow (mitigation: `minReplicas: 1` during demos); ACA's Envoy
  buffering behaviour is verified empirically, not assumed (the gate + ADR-0010
  fallback cover it); internal ingress means the api is only reachable from inside
  the environment (intended).
- **Follow-ups:** custom domain + managed cert, autoscaling tuning, and Key
  Vault-backed secrets are explicitly deferred (spec 0007). Image build, base
  image, and the subprocess-packaging constraints are **ADR-0012**.
