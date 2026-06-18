# 0008. Deploy workflow: GitHub Actions → Azure Container Apps via OIDC

- **Status:** Proposed
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
create`, the migrate/seed/verify job, and the smoke). A cheap per-commit gate
(`pnpm check`) and a **cost-gated, manually-triggered** deploy. No `deploy.yml` is
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

## One-time setup (manual precondition — run once by a subscription Owner)

The UAMI and federated credential exist; the remaining one-time step is the
**RG-scoped role grant** the deploy needs. Confirm it is in place (or run it) before
the first CI deploy. The repo owner is Owner at subscription scope, so has the
`roleAssignments/write` to create these:

```bash
# Resolve ids (az logged in as a subscription Owner).
PRINCIPAL_ID=$(az identity show -n ledgerlens-gh-oidc -g rg-ledgerlens --query principalId -o tsv)
RG_ID=$(az group show -n rg-ledgerlens --query id -o tsv)
ACR_NAME=$(az acr list -g rg-ledgerlens --query '[0].name' -o tsv)
ACR_ID=$(az acr show -n "$ACR_NAME" -g rg-ledgerlens --query id -o tsv)

# Deploy rights on the RG: Owner covers `az deployment group create` AND the AcrPull
# role assignment main.bicep self-creates (needs roleAssignments/write). The
# equivalent narrower split is: Contributor + "User Access Administrator".
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role Owner --scope "$RG_ID"

# Push images to ACR from the runner.
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role AcrPush --scope "$ACR_ID"
```

Honest note: **Owner on the RG already subsumes the ACR push action**, so the
explicit `AcrPush` is strictly redundant under Owner; it is kept explicit so it stays
correct if the RG role is ever narrowed below Owner (and to document intent). Both
grants are **RG/ACR-scoped — never subscription-scoped** (the UAMI itself is not a
subscription Owner; only the human who *creates* the grant is).

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

**3. CI gate — cheap and Docker-free, per commit.** On `pull_request` and `push` to
`main`, run **`pnpm check`** (lint + typecheck + unit/web tests) only. Integration
(`*.itest.ts`, testcontainers) and the eval are **out of the per-commit gate**:
- *Eval* already lives in `eval.yml` (manual dispatch + weekly) because it spends API
  tokens (ADR-0009) — unchanged.
- *Integration* moves to an opt-in/scheduled job for the same "keep the per-commit
  gate fast and Docker-free" reason.

  **Refinement flagged honestly:** today's `ci.yml` *also* runs `pnpm test:integration`
  on every push/PR, and spec 0007 §7 described it that way. Implementing this spec
  means trimming that step out of the per-commit gate into an opt-in job; the trade-off
  (less PR coverage for a faster gate) is accepted for a portfolio repo and is the
  owner's call to ratify.

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
- `pnpm check` runs on `pull_request` and `push` to `main`; the per-commit gate pulls
  **no Docker image** and does not run integration or eval.
- The deploy identity holds **only RG/ACR-scoped roles** — verify with
  `az role assignment list --assignee <clientId> --all` showing nothing at
  subscription scope.
- Re-running the deploy does **not** rotate the Postgres password (`PG_ADMIN_PASSWORD`
  supplied from the secret, so `deploy.sh` reuses it).

## Out of scope

`deploy.yml` itself (this spec defines it); Key Vault-backed secrets; tag- or
Environment-gated deploy and the extra federated credential each requires; auto-deploy
on push; running the eval or integration in the per-commit gate; multi-env, blue/green,
and automated rollback.
