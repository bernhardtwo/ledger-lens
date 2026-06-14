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

Docker is **not** required locally — images build server-side via `az acr build`.
`ANTHROPIC_API_KEY` is read from the repo `.env` (or pass it in the environment).

## Deploy

```bash
bash infra/deploy.sh
# overrides: LOCATION=canadacentral NAME_PREFIX=ledgerlens RG=rg-ledgerlens bash infra/deploy.sh
```

What it does:

1. `az group create`.
2. **Pass 1** — `main.bicep deployApps=false`: ACR, Postgres Flexible Server (B1ms,
   `?sslmode=require` enforced), ACA environment + Log Analytics.
3. Builds + pushes both glibc images to ACR. The `web` image bakes `API_BASE_URL`
   (the api's internal FQDN) at build time — Next rewrites are build-time, so a new
   environment means a `web` rebuild (spec 0007 §3).
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

## Cost & lifecycle

Idle ≈ ACR Basic (~$5/mo) + Postgres B1ms (~$13–16/mo running). Both apps scale to
zero. **Stop the DB between demos:**

```bash
az postgres flexible-server stop -n <server> -g rg-ledgerlens   # ~$4/mo stopped
az postgres flexible-server start -n <server> -g rg-ledgerlens  # before the next demo
```

Teardown everything: `az group delete -n rg-ledgerlens --yes --no-wait`.

## Known follow-ups

- **ACR auth**: admin credentials for now; managed-identity `acrPull` is the 2d
  hardening step.
- **Secrets**: ACA secrets now; Key Vault references are the documented upgrade path.
  The generated Postgres admin password is cached in `infra/.pg-password` (gitignored)
  so re-runs reuse it instead of rotating the credential.
- This IaC **compiles + lints + is reviewed** but has **not been deployed** to a live
  subscription yet (pending `az login`); expect minor deploy-time iteration.
