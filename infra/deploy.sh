#!/usr/bin/env bash
# LedgerLens — Phase 7 Step 2b deploy (ADR-0011, spec 0007).
#
# Provisions the Azure stack (Bicep), builds+pushes the glibc images to ACR (server-side
# via ACR Tasks, with an automatic local `docker build`+push fallback when ACR Tasks is
# blocked — see BUILD_MODE), deploys api+web, runs the fail-closed migrate/seed/verify job
# against managed Postgres, then the NON-SSE smoke. Re-runnable. SSE-through-Envoy is 2c.
#
# Prereqs: `az login` (active subscription); ANTHROPIC_API_KEY in the repo .env or the
# environment; python3 (Ubuntu default) for JSON parsing. Run from anywhere:
#   bash infra/deploy.sh
#   env knobs: LOCATION, NAME_PREFIX, RG, PG_ADMIN_USER, IMAGE_TAG, SMOKE_ASK=0, BUILD_MODE
set -euo pipefail

# Default region centralus: the project's Azure-for-Students subscription is bound by an
# "Allowed resource deployment regions" policy AND Postgres Flexible Server is offer-
# restricted (LocationIsOfferRestricted) in every allowed region except centralus (see
# infra/README.md "Known environment constraints"). Override for an unrestricted sub.
LOCATION="${LOCATION:-centralus}"
NAME_PREFIX="${NAME_PREFIX:-ledgerlens}"
RG="${RG:-rg-${NAME_PREFIX}}"
PG_ADMIN_USER="${PG_ADMIN_USER:-lladmin}"
SMOKE_ASK="${SMOKE_ASK:-1}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Image tag = git SHA, marked -dirty on an uncommitted tree so the image<->commit
# mapping stays honest (CLAUDE.md: history is portfolio evidence).
if [ -z "${IMAGE_TAG:-}" ]; then
  IMAGE_TAG="$(git rev-parse --short HEAD)"
  [ -n "$(git status --porcelain)" ] && IMAGE_TAG="${IMAGE_TAG}-dirty"
fi

# ---- secrets (never echoed) ----
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -f .env ]; then
  # cut keeps '=' in the value; tr strips a Windows CRLF (this is a WSL-on-Windows repo).
  ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
fi
[ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "ERROR: ANTHROPIC_API_KEY not set and not in .env" >&2; exit 1; }

# Postgres admin password: generated once and PERSISTED (gitignored) so re-runs reuse
# it. Re-passing the same value keeps the server password stable; a fresh value each
# run would rotate it and strand the api's DATABASE_URL secret. Key Vault is the
# documented upgrade (spec 0007 §5).
PW_FILE="infra/.pg-password"
if [ -n "${PG_ADMIN_PASSWORD:-}" ]; then
  :
elif [ -f "$PW_FILE" ]; then
  PG_ADMIN_PASSWORD="$(tr -d '\r\n' < "$PW_FILE")"
else
  PG_ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9')Aa1!"
  ( umask 077; printf '%s' "$PG_ADMIN_PASSWORD" > "$PW_FILE" )
fi

# ---- preflight ----
az account show >/dev/null 2>&1 || { echo "ERROR: run 'az login' first" >&2; exit 1; }
echo "Subscription : $(az account show --query name -o tsv)"
echo "Region / RG  : $LOCATION / $RG"
echo "Image tag    : $IMAGE_TAG"

az group create -n "$RG" -l "$LOCATION" -o none

deployment_out() { az deployment group show -g "$RG" -n main --query "properties.outputs.$1.value" -o tsv; }

# ---- pass 1: infra only (ACR, Postgres, ACA env) ----
echo "== pass 1: provisioning infra =="
az deployment group create -g "$RG" -n main -f infra/main.bicep -o none \
  -p location="$LOCATION" namePrefix="$NAME_PREFIX" \
     postgresAdminUser="$PG_ADMIN_USER" postgresAdminPassword="$PG_ADMIN_PASSWORD" \
     deployApps=false

ACR_NAME="$(deployment_out acrName)"
ENV_DOMAIN="$(deployment_out envDefaultDomain)"
PG_FQDN="$(deployment_out pgFqdn)"
# api uses internal ingress; its FQDN is deterministic from the env's default domain,
# so we can bake it into the web image BEFORE the api app exists (Next rewrites are
# build-time — spec 0007 §3). Verified against the real output after pass 2.
API_HOST="${NAME_PREFIX}-api.internal.${ENV_DOMAIN}"
API_BASE_URL="https://${API_HOST}"
DATABASE_URL="postgresql://${PG_ADMIN_USER}:${PG_ADMIN_PASSWORD}@${PG_FQDN}:5432/ledgerlens?sslmode=require"

# ---- build + push images ----
# Default path is server-side `az acr build` (ACR Tasks): no local Docker, and the
# .dockerignore keeps the uploaded context small. Some subscriptions (e.g. Azure for
# Students) block ACR Tasks with `TasksOperationsNotAllowed`; on that specific error we
# fall back to a local `docker build`+`docker push` (needs a running Docker daemon). The
# fallback pins linux/amd64 so the image runs on ACA regardless of the build host's arch.
#   BUILD_MODE=auto  (default) try ACR Tasks; fall back to local only on TasksOperationsNotAllowed
#   BUILD_MODE=acr   require ACR Tasks (fail if unavailable)
#   BUILD_MODE=local always build locally (skip ACR Tasks)
BUILD_MODE="${BUILD_MODE:-auto}"
case "$BUILD_MODE" in auto|acr|local) ;; *) echo "ERROR: BUILD_MODE must be auto|acr|local (got '$BUILD_MODE')" >&2; exit 1 ;; esac
REG="$(deployment_out acrLoginServer)"
ACR_LOGGED_IN=0

docker_login_acr() {
  [ "$ACR_LOGGED_IN" = 1 ] && return 0
  command -v docker >/dev/null || { echo "ERROR: local image build needs Docker, which is not installed" >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo "ERROR: local image build needs a running Docker daemon" >&2; exit 1; }
  # ACR admin user is disabled (ADR-0013) — authenticate docker with the caller's AAD
  # token (`az acr login`) rather than a stored registry password.
  az acr login --name "$ACR_NAME"
  ACR_LOGGED_IN=1
}

# build_push <name:tag> <dockerfile> [extra docker/acr build args...]
build_push() {
  local tag="$1" dockerfile="$2"; shift 2
  if [ "$BUILD_MODE" != "local" ]; then
    echo "== az acr build $tag =="
    local log; log="$(mktemp)" || { echo "ERROR: mktemp failed" >&2; exit 1; }
    # Decide off az's own exit (PIPESTATUS[0]), not tee's, so a full/unwritable $TMPDIR
    # can't invert a successful build into a spurious failure. errexit is off around the
    # pipeline because a non-zero az here is an expected, recoverable signal (Tasks off).
    set +e
    az acr build -r "$ACR_NAME" -t "$tag" -f "$dockerfile" "$@" . -o none 2>&1 | tee "$log"
    local rc=${PIPESTATUS[0]}
    set -e
    if [ "$rc" -eq 0 ]; then rm -f "$log"; return 0; fi
    # Fall back to local ONLY on the specific ACR-Tasks-disabled error, matched on the
    # CLI's error header / Code line (not a bare substring); any other failure aborts.
    if [ "$BUILD_MODE" = "acr" ] || ! grep -qE '\(TasksOperationsNotAllowed\)|(Code|"code"):[[:space:]]*"?TasksOperationsNotAllowed' "$log"; then
      rm -f "$log"; echo "ERROR: az acr build failed for $tag (exit $rc)" >&2; exit 1
    fi
    rm -f "$log"
    echo "== ACR Tasks unavailable (TasksOperationsNotAllowed) -> local docker build =="
  fi
  docker_login_acr
  echo "== docker build + push $tag (local, linux/amd64) =="
  docker build --platform linux/amd64 -f "$dockerfile" "$@" -t "${REG}/${tag}" .
  docker push "${REG}/${tag}"
}

echo "== building images ($ACR_NAME) =="
build_push "${NAME_PREFIX}-api:${IMAGE_TAG}" apps/api/Dockerfile
build_push "${NAME_PREFIX}-web:${IMAGE_TAG}" apps/web/Dockerfile --build-arg API_BASE_URL="$API_BASE_URL"

# ---- pass 2: deploy apps + migrate job ----
echo "== pass 2: deploying apps =="
az deployment group create -g "$RG" -n main -f infra/main.bicep -o none \
  -p location="$LOCATION" namePrefix="$NAME_PREFIX" \
     postgresAdminUser="$PG_ADMIN_USER" postgresAdminPassword="$PG_ADMIN_PASSWORD" \
     imageTag="$IMAGE_TAG" deployApps=true \
     databaseUrl="$DATABASE_URL" anthropicApiKey="$ANTHROPIC_API_KEY"

WEB_FQDN="$(deployment_out webFqdn)"
API_FQDN_ACTUAL="$(deployment_out apiInternalFqdn)"
# Self-check: the FQDN we predicted (and baked into the web image) must match reality,
# else the web->api proxy points at the wrong host.
if [ "$API_FQDN_ACTUAL" != "$API_HOST" ]; then
  echo "ERROR: predicted api FQDN ($API_HOST) != actual ($API_FQDN_ACTUAL); rebuild web" >&2
  exit 1
fi

# ---- migrate / seed / verify (fail-closed: verify-seed throws on no seed or no TLS) ----
echo "== running migrate/seed/verify job =="
az containerapp job start -n "${NAME_PREFIX}-migrate" -g "$RG" -o none
status=""
for _ in $(seq 1 90); do
  status="$(az containerapp job execution list -n "${NAME_PREFIX}-migrate" -g "$RG" \
    --query "reverse(sort_by([].{t:properties.startTime,s:properties.status}, &t))[0].s" -o tsv 2>/dev/null || true)"
  echo "  migrate job: ${status:-pending}"
  { [ "$status" = "Succeeded" ] || [ "$status" = "Failed" ]; } && break
  sleep 5
done
echo "-- migrate job logs (expect: db tls: session_ssl=true ... ; seed verification ok) --"
az containerapp job logs show -n "${NAME_PREFIX}-migrate" -g "$RG" --container migrate --tail 30 || true
# Fail the deploy if the fail-closed job did not succeed (a no-op/error must NOT pass).
[ "$status" = "Succeeded" ] || { echo "ERROR: migrate/seed/verify did not succeed (status=${status:-timeout})" >&2; exit 1; }

# ---- non-SSE smoke (public web -> internal api) ----
echo "== non-SSE smoke =="
echo "web root  : $(curl -fsS -o /dev/null -w '%{http_code}' "https://$WEB_FQDN/")"
echo "api health: $(curl -fsS "https://$WEB_FQDN/api/health")"
ACCOUNTS="$(curl -fsS "https://$WEB_FQDN/api/accounts")"
echo "accounts  : $ACCOUNTS"
ACCT="$(printf '%s' "$ACCOUNTS" | python3 -c 'import sys,json; print(json.load(sys.stdin)["accounts"][0]["id"])')" \
  || ACCT="$(printf '%s' "$ACCOUNTS" | grep -oP '"id":"\K[^"]+' | head -1)"
echo "txns      : $(curl -fsS "https://$WEB_FQDN/api/accounts/$ACCT/transactions?limit=3" | head -c 300)"

# secret-to-child: one NON-streaming /ask spawns the MCP child; a real currency figure
# proves DATABASE_URL reached the child and it queried managed Postgres over TLS. Costs
# one Anthropic turn — set SMOKE_ASK=0 to skip on routine re-deploys.
if [ "$SMOKE_ASK" = "1" ]; then
  ANSWER="$(curl -fsS -X POST "https://$WEB_FQDN/api/accounts/$ACCT/ask" \
    -H 'content-type: application/json' -d '{"question":"How much did I spend on groceries in May?"}')"
  echo "ask(JSON) : $ANSWER"
  # Accept a symbol-prefixed figure ($130 / €130) OR a number with a trailing ISO code
  # (130.00 EUR / 130 USD) — the agent phrases the amount either way.
  printf '%s' "$ANSWER" | grep -qiE '[$€£][0-9]|[0-9][0-9.,]*[[:space:]]*(eur|usd|gbp)' \
    || { echo "ERROR: /ask returned no currency figure (secret-to-child unproven)" >&2; exit 1; }
  echo "secret-to-child: confirmed (MCP child reached managed Postgres over TLS)"
fi

echo
echo "== done. cost control: stop the DB when idle =="
PG_NAME="$(az postgres flexible-server list -g "$RG" --query '[0].name' -o tsv)"
echo "  az postgres flexible-server stop -n $PG_NAME -g $RG     # ~\$4/mo stopped"
echo "  teardown:  az group delete -n $RG --yes --no-wait"
