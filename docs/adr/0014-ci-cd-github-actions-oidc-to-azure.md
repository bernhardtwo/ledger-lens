# 0014. CI/CD: GitHub Actions deploys to Azure Container Apps via OIDC

- **Status:** Proposed
- **Date:** 2026-06-18

## Context

The live stack (ADR-0011 topology, ADR-0012 images, ADR-0013 observability)
deploys today through the manual `infra/deploy.sh`: `az login` → two-pass
`az deployment group create` on `infra/main.bicep` → build/push images →
migrate/seed/verify job → smoke. The remaining Phase 7 automation (README
"Known follow-ups") is a hands-off GitHub Actions deploy. This ADR records **how
that deploy authenticates and runs**; it deliberately does not write the workflow.

Forces at play:

- **No long-lived cloud secret in GitHub.** A stored service-principal password
  is a rotation burden and a high-value leak target. GitHub's OIDC token federated
  to Azure removes it — the workflow gets a short-lived token, nothing persisted.
- **Reuse the IaC, don't fork it.** `infra/main.bicep` is the source of truth
  (resource-group scope, two-pass via `deployApps`). CI must invoke the same
  `az deployment group create`, never a parallel definition that can drift.
- **ACR Tasks is blocked on this subscription.** `az acr build` returns
  `TasksOperationsNotAllowed` (README "Known environment constraints"), so
  `deploy.sh` already falls back to a local `docker build`+push. Server-side image
  build is not available here; the build must run on the runner.
- **Cost: a $100 hard cap, deliberately parked between demos.** Both apps scale to
  zero and Postgres is **stopped** between demos (RUNBOOK). The live environment
  gains nothing from being continuously current, and the deploy's own
  migrate/seed/verify + smoke require a **running** DB. So "deploy on every push to
  main" is wrong on both cost and correctness.
- **Tenant capability is uncertain.** The target is an **Azure for Students**
  subscription with documented restrictions (region policy, ACR Tasks). Whether it
  permits creating an Entra app registration + federated credential + resource-group
  role assignments is **not verified** and must not be assumed.

Determinism-first (ADR-0004) is unaffected: CI/CD adds no LLM surface. The optional
eval gate exercises the **existing** agent (ADR-0008/0009), not a new one.

## Decision

**1. GitHub Actions is the CI/CD platform**, deploying by invoking the existing
`infra/main.bicep` via `az deployment group create` on `rg-ledgerlens` — the same
two-pass flow `deploy.sh` runs. No parallel IaC.

**2. Auth: OIDC workload-identity federation, no stored secret.** A federated
credential trusts GitHub's OIDC token (subject scoped to this repo and the specific
ref/environment), so the job receives a short-lived Azure token with no client
secret in GitHub. This is the recommended option precisely because it keeps **no
long-lived cloud credential** anywhere in the CI system.

**3. Identity scoping: resource-group-scoped, not subscription-wide.** The
federated identity is granted roles on `rg-ledgerlens` only. Honest consequence:
because the Bicep **self-assigns `AcrPull`** (`main.bicep` `roleAssignments`), the
deploying principal needs role-assignment write — so the RG-scoped grant is
realistically **Owner** (or **Contributor + User Access Administrator**), plus the
ability to **push to ACR** (`AcrPush`), not bare Contributor. A tighter split is in
§Alternatives.

**4. Image build on the runner.** Build both glibc images on the GitHub runner and
push to ACR via `az acr login` (AAD token; the ACR admin user stays disabled,
ADR-0013). This mirrors `deploy.sh`'s `BUILD_MODE=local` fallback and is **forced**
by `TasksOperationsNotAllowed`. Tag images by commit SHA (as `deploy.sh` does, to
keep the image↔commit map honest) and reproduce the build-time
`--build-arg API_BASE_URL` the `web` image bakes (spec 0007 §3).

**5. Trigger policy is cost-aware, not push-driven.**
- **On PR / push to `main`:** the fast, free gate only — `pnpm check` (lint +
  typecheck + unit/web tests). No cloud, no deploy.
- **Deploy is manual** (`workflow_dispatch`), optionally tag-triggered (e.g. a
  `deploy-*` tag), and **never on push to `main`.** A deploy is a demo-time action:
  a human starts Postgres (RUNBOOK), then triggers it; the job runs the Bicep +
  migrate + smoke against the running DB.
- **The eval gate (ADR-0009) is opt-in, not per-PR**: it needs `ANTHROPIC_API_KEY`,
  Docker/testcontainers, and spends real tokens, so it runs on demand under the cost
  cap, not on every PR.

**6. App secrets are out of scope here.** OIDC removes the *cloud-auth* secret, but
the deploy still needs `ANTHROPIC_API_KEY` and the Postgres admin password (→
`DATABASE_URL`), which live as GitHub Actions secrets until the deferred **Key
Vault** decision moves them. This ADR is scoped to CI/CD **auth + deploy**;
Key Vault-backed secrets remain a separate, deferred ADR (spec 0007 §5).

**Precondition to verify before implementing — do not assume it works.** Confirm
that the tenant permits (a) creating the federated identity and (b) creating the
RG-scoped role assignment(s) it needs. Entra app-registration creation and
`Microsoft.Authorization/roleAssignments/write` are commonly restricted on
student/managed tenants. Probe read-only first, then pick the highest rung the
tenant actually allows from this chain:

1. **User-assigned managed identity + federated credential** — no app registration,
   no secret. Preferred, if the tenant allows UAMI federated credentials and the RG
   role assignment.
2. **Entra app registration + federated credential** — equivalent OIDC, but needs
   app-registration rights.
3. **Stored service-principal secret in GitHub Secrets** — last resort, only if
   federation is disallowed entirely. A long-lived, manually-rotated credential.

## Alternatives considered

- **Stored service-principal secret in GitHub Secrets** — works on any tenant, but
  puts a long-lived cloud credential in GitHub (rotation burden, leak target).
  Demoted to the last-resort fallback, used only if federation is tenant-blocked.
- **Auto-deploy on every push to `main`** — rejected on cost *and* correctness: the
  env is parked with Postgres stopped under a $100 cap, and the deploy's
  migrate/seed/verify + smoke need a running DB, so routine commits would fail or
  force paid resources up for no demo. Manual/tag deploy ties spend to real demos.
- **Server-side image build (ACR Tasks `az acr build`)** — cleaner (no Docker on the
  runner) but **blocked on this subscription** (`TasksOperationsNotAllowed`).
  Runner-side `docker build`+push is the only option here, as `deploy.sh` reflects.
- **Tighter privilege: split provision from deploy** — keep one-time infra
  provisioning (ACR/Postgres/ACA env/identity/role assignment) a human-run
  `deploy.sh`, and give CI only **AcrPush + Container Apps update** rights (push the
  image, `az containerapp update` the revision — no role-assignment write). Recorded
  as the fallback if the broad RG grant is unacceptable or tenant-blocked; not chosen
  now because re-running the idempotent full Bicep keeps a single deploy path.
- **Subscription-scoped identity** — rejected: more blast radius than a single-RG
  demo needs.

## Consequences

- **Positive:** no long-lived Azure credential in GitHub (short-lived OIDC tokens);
  CI calls the same `main.bicep` / `az deployment group create` as `deploy.sh`, so
  local and CI deploys cannot drift; identity blast radius bounded to
  `rg-ledgerlens`; deploys cost money only when a human triggers one for a demo; the
  GitHub Ubuntu runner sidesteps the WSL-specific Bicep ICU workaround entirely.
- **Negative (accepted):** "RG-scoped least privilege" is still a powerful role
  (Owner / Contributor + User Access Administrator + AcrPush) because the IaC
  self-assigns a role — the tighter split is documented, not taken; app secrets stay
  in GitHub Secrets until Key Vault; the manual trigger means deploys are not
  automatic (intended — it is the cost lever); the OIDC path is **contingent on a
  tenant capability not yet verified** (fallback chain above).
- **Follow-ups:** verify the tenant capability, then write `deploy.yml` per this ADR
  (the workflow is intentionally not part of this ADR); move app secrets to Key Vault
  (separate deferred ADR); optionally add the on-demand eval-gate job (ADR-0009).
  Flip this ADR to **Accepted** once the capability probe pins a concrete rung.
