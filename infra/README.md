# Phase 7 — Azure deployment (Step 2b)

Infrastructure-as-code for the Azure Container Apps stack (ADR-0011, spec 0007):
`web` (external ingress) + `api` (internal ingress), Azure Database for PostgreSQL
Flexible Server (managed, TLS-enforced), ACR, and ACA secrets. Observability /
App Insights is **2d**; the streaming-SSE-through-Envoy gate is **2c**.

```
infra/main.bicep   the stack (two-pass via deployApps: infra, then apps)
infra/deploy.sh    provision -> build/push images -> deploy -> migrate/verify -> smoke
```

## Prerequisites (one-time, requires YOU — interactive)

`az` is not installed in this WSL by default, and `az login` is interactive — both
need you:

```bash
# 1. Install the Azure CLI (needs sudo password):
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
# 2. Authenticate (opens a browser / device code):
az login
az account set --subscription "<your-subscription>"
```

Docker is **not** required when ACR Tasks (`az acr build`) is available — images build
server-side. If ACR Tasks is blocked (see *Known environment constraints*), `deploy.sh`
falls back to a local `docker build`+push, which **does** need a running Docker daemon.
`ANTHROPIC_API_KEY` is read from the repo `.env` (or pass it in the environment).

## Deploy

```bash
bash infra/deploy.sh
# overrides: LOCATION=centralus NAME_PREFIX=ledgerlens RG=rg-ledgerlens BUILD_MODE=auto bash infra/deploy.sh
```

What it does:

1. `az group create`.
2. **Pass 1** — `main.bicep deployApps=false`: ACR, Postgres Flexible Server (B1ms,
   `?sslmode=require` enforced), ACA environment + Log Analytics.
3. Builds + pushes both glibc images to ACR — server-side via ACR Tasks (`az acr build`)
   by default, or a local `docker build`+push fallback when ACR Tasks is blocked
   (`BUILD_MODE`, see *Known environment constraints*). The `web` image bakes
   `API_BASE_URL` (the api's internal FQDN) at build time — Next rewrites are build-time,
   so a new environment means a `web` rebuild (spec 0007 §3).
4. **Pass 2** — `main.bicep deployApps=true`: the two container apps + the migrate
   job, with `DATABASE_URL` + `ANTHROPIC_API_KEY` as **ACA secrets**.
5. Starts the **migrate/seed/verify** job and waits (deploy.sh exits non-zero if the
   job does not succeed). `verify-seed` is fail-closed: it throws unless every seed
   account is present with transactions **and**, when `sslmode=require` is set,
   `pg_stat_ssl` shows the session is encrypted; it also logs the server's
   `require_secure_transport`. (A URL that *drops* `sslmode` against the TLS-requiring
   managed server fails to connect at all, so plaintext can't slip through.)
6. **Non-SSE smoke**: web root, `GET /api/health`, `GET /api/accounts` (picker), a
   `GET /api/accounts/:id/transactions` data call, and one **non-streaming**
   `POST /api/accounts/:id/ask` (gated by `SMOKE_ASK=1`, the default) — the script
   asserts the answer contains a currency figure, proving `DATABASE_URL` reached the
   spawned MCP child and it queried managed Postgres over TLS. `SMOKE_ASK=0` skips that
   one Anthropic turn on routine re-deploys.

## Known environment constraints (this subscription / WSL)

The live target is an **Azure for Students** subscription driven from **WSL**. Three
environment limits were hit on the first deploy and are now handled by the defaults
above; they may not apply to other subscriptions:

- **Region — centralus only.** An "Allowed resource deployment regions" policy limits the
  sub to `westus2, eastus, southcentralus, centralus, eastus2`, and Postgres Flexible
  Server is offer-restricted (`LocationIsOfferRestricted`) in all of those **except
  centralus** — hence the `centralus` default. Probe a region read-only with the
  capabilities API: `Microsoft.DBforPostgreSQL/locations/<loc>/capabilities`.
- **ACR Tasks blocked.** `az acr build` returns `TasksOperationsNotAllowed` on this sub,
  so `deploy.sh` auto-falls back to a local `docker build`+push (`BUILD_MODE=auto`). Force
  it with `BUILD_MODE=local`; require server-side with `BUILD_MODE=acr`.
- **Bicep ICU crash (WSL).** The az-bundled Bicep is a self-contained .NET binary that can
  crash on this WSL's ICU during console-encoding init (a globalization fault, not a
  template error). Work around it by exporting invariant globalization before deploying:

  ```bash
  export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
  bash infra/deploy.sh
  ```

  It is harmless elsewhere (Bicep needs no culture data) and is kept out of `deploy.sh`
  because it is specific to this WSL host, not the deploy logic.

## Cost & lifecycle

Idle ≈ ACR Basic (~$5/mo) + Postgres B1ms (~$13–16/mo running). Both apps scale to
zero. **Stop the DB between demos:**

```bash
az postgres flexible-server stop -n <server> -g rg-ledgerlens   # ~$4/mo stopped
az postgres flexible-server start -n <server> -g rg-ledgerlens  # before the next demo
```

Day-2 operations (deploy, start/stop, **view traces**, KQL) live in
[`infra/RUNBOOK.md`](./RUNBOOK.md). Teardown everything:
`az group delete -n rg-ledgerlens --yes --no-wait`.

## Observability (2d — ADR-0013)

A workspace-based **Application Insights** (`ledgerlens-appi`, on the existing LAW)
receives the api's **OpenTelemetry**: HTTP request traces, an `agent.ask` span per
question, **per-tool `agent.tool …` child spans**, and `agent.cost_usd`/`agent.turns`
metrics. Init is `node --import dist/observability/instrumentation.js`, a **no-op unless
`APPLICATIONINSIGHTS_CONNECTION_STRING` is set** (api-only ACA secret). See the runbook
for how to view traces.

## Known follow-ups

- **ACR auth**: ✅ done — apps + the job pull via a user-assigned managed identity
  (`AcrPull`); the ACR **admin user is disabled** and `deploy.sh` pushes via `az acr
  login`, so no registry password is stored anywhere.
- **Secrets**: ACA secrets (`database-url`, `anthropic-api-key`,
  `appinsights-connection-string`); **Key Vault** references are the deferred upgrade
  path. The Postgres admin password is cached in `infra/.pg-password` (gitignored) so
  re-runs reuse it instead of rotating the credential.
- **CI/CD**: a GitHub Actions `deploy.yml` (OIDC, build/push, Bicep deploy) is the
  remaining Phase 7 automation; deploys are manual via `deploy.sh` today.
- **Deployed live** to `centralus` (Azure for Students): both apps healthy, managed-PG
  migrate/seed/verify green over TLS, the non-SSE smoke + secret-to-child passed, the
  streaming-SSE-through-Envoy gate (2c) verified **un-buffered**, and App Insights /
  OpenTelemetry (2d) wired.
