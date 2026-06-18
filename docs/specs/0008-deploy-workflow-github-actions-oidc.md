# 0008. Deploy workflow: GitHub Actions → Azure Container Apps via OIDC

- **Status:** Accepted
- **Date:** 2026-06-18
- **Phase:** 7 (the CI/CD automation deferred from spec 0007 §7)
- **Builds on:** **ADR-0014** (the authoritative CI/CD auth + deploy decision),
  spec 0007 §7 (the `deploy.yml` sketch this fleshes out), ADR-0011/0012 (topology +
  images), ADR-0009 (eval gate), ADR-0004 (determinism boundary). Reuses
  `infra/deploy.sh` and `infra/main.bicep` **verbatim** rather than re-implementing
  them in YAML.

## Summary / Goal

Define the hands-off deploy from GitHub Actions to the existing ACA stack per
ADR-0014: authenticate with **OIDC workload-identity federation** (no stored cloud
secret), build images **on the runner** and push to ACR, and run the existing
`infra/deploy.sh` (which already orchestrates the two-pass `az deployment group
create`, the migrate/seed/verify job, and the smoke). A per-commit gate (`pnpm check`
+ integration tests) and a **cost-gated, manually-triggered** deploy. No `deploy.yml` is
written here — this spec defines what it must do.

## Determinism-vs-LLM decision (central)

| Unit of work | Kind | Rationale |
|---|---|---|
| The entire deploy workflow (auth, build, push, `deployment group create`) | **N/A — no LLM** | Pure infra/automation; no model is called, no determinism boundary is crossed. |
| The opt-in eval job (`eval.yml`, unchanged) | `unchanged` | Exercises the existing Phase 4 agent (ADR-0008/0009); adds no new LLM surface. |

**Hard guarantee:** this is CI/CD automation around an unchanged application. ADR-0004's
determinism boundary and the eval (ADR-0009) are untouched.

## Identity (verified — ADR-0014)

Auth uses the existing user-assigned managed identity **`ledgerlens-gh-oidc`** in
`rg-ledgerlens` (clientId `518a5940-6d3b-4518-9f36-546990f42f24`) and its federated
credential **`gh-main`** (subject `repo:bernhardtwo/ledger-lens:ref:refs/heads/main`,
issuer GitHub Actions OIDC, audience `api://AzureADTokenExchange`). No Entra app
registration, no stored secret.

## One-time setup (manual preconditions — run once by a subscription Owner)

The UAMI and its `gh-main` federated credential already exist. Three one-time steps
remain; the repo owner is Owner at subscription scope, so holds the
`roleAssignments/write` for step 1.

**1. Grant the UAMI `Owner` on the resource group.** Owner covers both
`az deployment group create` **and** the `AcrPull` role assignment `main.bicep`
self-creates (which needs `roleAssignments/write`). `AcrPush` is **redundant under
Owner** — Owner already includes the registry push action — so it is omitted. The
grant is **RG-scoped, never subscription-scoped** (the UAMI is not a subscription
Owner; only the human creating the grant is):

```bash
RG_ID=$(az group show -n rg-ledgerlens --query id -o tsv)
az role assignment create \
  --assignee-object-id 8288260e-cb4d-4163-8c33-072f02f0753e \
  --assignee-principal-type ServicePrincipal \
  --role Owner --scope "$RG_ID"
```

**2. Set GitHub repo variables** (non-sensitive identifiers — OIDC has no secret):

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | `518a5940-6d3b-4518-9f36-546990f42f24` (the UAMI clientId) |
| `AZURE_TENANT_ID` | the directory (tenant) id |
| `AZURE_SUBSCRIPTION_ID` | the target subscription id |

**3. Set GitHub repo secrets** — the **exact names `deploy.sh` reads from the
environment**, so the deploy job maps them straight through:

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | the api's agent key (becomes an ACA secret on deploy) |
| `PG_ADMIN_PASSWORD` | Postgres admin password `deploy.sh` reuses (so a re-deploy does not rotate it) |

## Decisions

**1. Reuse, don't fork.** The deploy job runs `infra/deploy.sh`; it does **not**
re-implement build/push or `az deployment group create` in YAML. `deploy.sh` already
performs exactly the steps ADR-0014 calls for (runner-side build/push with the
`BUILD_MODE=local` fallback → two-pass `az deployment group create` on
`infra/main.bicep` with its parameters → fail-closed migrate/seed/verify job →
smoke). This keeps local and CI deploys byte-identical.

**2. Auth: `azure/login@v2` via OIDC.** The job requests `permissions: id-token:
write` (+ `contents: read`) and calls `azure/login@v2` with `client-id`, `tenant-id`,
`subscription-id`. Those three are **non-sensitive identifiers** (OIDC means there is
no secret to leak), stored as **GitHub repo variables** `AZURE_CLIENT_ID` (the UAMI
clientId above), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (repo *secrets* are also
acceptable). After login, `az account show` succeeds, satisfying `deploy.sh`'s
preflight.

**3. CI gate — `pnpm check` + integration, per commit.** On `pull_request` and
`push` to `main`, run **`pnpm check`** (lint + typecheck + unit/web tests) **and
`pnpm test:integration`** (the `*.itest.ts` suite over a testcontainers Postgres;
ubuntu runners ship Docker). The **eval is the only opt-in** gate: it already lives in
`eval.yml` (manual dispatch + weekly) because it spends API tokens (ADR-0009), and
stays there. This is exactly what today's `ci.yml` already does, so **no CI change is
needed** beyond leaving it as-is.

**4. Deploy job — cost-gated, manual, never on push.** Trigger is
**`workflow_dispatch`** (and/or a tag — see §5), and **never `push` to `main`**, per
ADR-0014's cost reasoning ($100 cap; both apps scale to zero; Postgres is *stopped*
between demos and the deploy's own migrate/seed/verify + smoke need it *running*).
Steps:
1. `azure/login@v2` (OIDC, §2).
2. `bash infra/deploy.sh`, with workflow env: `BUILD_MODE=local` (ACR Tasks is blocked
   on this subscription — README "Known environment constraints"), `ANTHROPIC_API_KEY`
   and `PG_ADMIN_PASSWORD` injected from **GitHub secrets**. The WSL-only
   `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT` workaround is **not** set — the Ubuntu
   runner does not hit the Bicep ICU bug.

   **Precondition (operator):** start Postgres before dispatching (RUNBOOK
   `az postgres flexible-server start`); the deploy fails closed otherwise.
   **`PG_ADMIN_PASSWORD` must come from a secret** — `deploy.sh` reuses it when the env
   var is set; if it were absent, the script would generate a *new* password and rotate
   the server credential, stranding the api's `DATABASE_URL`.

**5. Federated-credential subject caveat.** `gh-main`'s subject
(`…:ref:refs/heads/main`) matches an OIDC token only for a run **on the `main`
branch** — i.e. `workflow_dispatch` on `main` (the shipped trigger). Two later gating
options each change the token subject and so each need an **additional federated
credential** added first:
- **Tag-triggered deploy** → subject `…:ref:refs/tags/<pattern>`; needs a matching
  credential before a tag run can authenticate.
- **GitHub Environment-gated deploy** (e.g. `environment: production`) → subject
  `…:environment:<name>`; needs a matching credential.

Environment-based protection (with required-reviewer approval) is the **cleaner**
long-term gate and is left as a **follow-up decision** — it adds a human approval step
*and* requires its own federated credential. Until then, the deploy ships as
`workflow_dispatch` on `main`.

**6. App secrets stay GitHub secrets (Key Vault deferred).** OIDC removes the
cloud-auth secret, but the deploy still needs `ANTHROPIC_API_KEY` and
`PG_ADMIN_PASSWORD`; they live as GitHub Actions secrets until the deferred Key Vault
decision (ADR-0014 §6, spec 0007 §5). Out of scope here.

## Acceptance / verification gates

- A `workflow_dispatch` run on `main` authenticates via OIDC with **no stored cloud
  credential** and completes a deploy that passes `deploy.sh`'s own fail-closed
  migrate/seed/verify + the non-SSE smoke (and the SSE-through-Envoy gate stays
  un-buffered, ADR-0011 / spec 0007).
- `pnpm check` **and** `pnpm test:integration` run on `pull_request` and `push` to
  `main`; only the **eval** is opt-in (`eval.yml`, manual + weekly).
- The deploy identity holds **only RG/ACR-scoped roles** — verify with
  `az role assignment list --assignee <clientId> --all` showing nothing at
  subscription scope.
- Re-running the deploy does **not** rotate the Postgres password (`PG_ADMIN_PASSWORD`
  supplied from the secret, so `deploy.sh` reuses it).

## Out of scope

`deploy.yml` itself (this spec defines it); Key Vault-backed secrets; tag- or
Environment-gated deploy and the extra federated credential each requires; auto-deploy
on push; running the eval in the per-commit gate; multi-env, blue/green,
and automated rollback.
