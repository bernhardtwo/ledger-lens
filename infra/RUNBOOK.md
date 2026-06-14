# LedgerLens — Phase 7 operations runbook

Operational guide for the deployed Azure Container Apps stack (ADR-0011 topology,
ADR-0013 observability, spec 0007). The stack: **web** (public) → Next proxy → **api**
(internal) → **Postgres Flexible Server**; images in **ACR** (pulled via a user-assigned
managed identity); telemetry in **Application Insights** on the shared Log Analytics
workspace.

Run everything from WSL with the Azure CLI logged in (`az login`). Resource group:
`rg-ledgerlens` in **centralus** (see `infra/README.md` for why centralus).

## Names (deterministic; confirm with `az resource list -g rg-ledgerlens -o table`)

| Thing | Name |
|---|---|
| Resource group | `rg-ledgerlens` |
| Postgres | `ledgerlens-pg-<suffix>` |
| App Insights | `ledgerlens-appi` |
| Web (public) | `ledgerlens-web` |
| Api (internal) | `ledgerlens-api` |
| Migrate job | `ledgerlens-migrate` |

## Deploy / redeploy

```bash
# This WSL host needs the Bicep ICU workaround (see infra/README "Known environment
# constraints"); harmless elsewhere.
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
bash infra/deploy.sh          # provision -> build+push (local fallback) -> deploy -> migrate -> smoke
```

`deploy.sh` is re-runnable and fail-closed (it exits non-zero if migrate/seed/verify does
not succeed). It builds images locally and pushes via `az acr login` (ACR admin user is
disabled — no stored registry password).

## Start / stop the database (cost control)

Postgres is the dominant idle cost; **stop it between demos** (it auto-restarts within 7
days, or start it manually before a demo):

```bash
PG=$(az postgres flexible-server list -g rg-ledgerlens --query '[0].name' -o tsv)
az postgres flexible-server start -n "$PG" -g rg-ledgerlens   # before a demo (~2 min)
az postgres flexible-server stop  -n "$PG" -g rg-ledgerlens   # after a demo
```

## Cold-start lever for a live demo

Both apps scale to zero; the binary-heavy api is slow on the first request after idle
(ADR-0011 §3). To keep the api warm for the duration of a demo only:

```bash
az containerapp update -n ledgerlens-api -g rg-ledgerlens --min-replicas 1   # warm
az containerapp update -n ledgerlens-api -g rg-ledgerlens --min-replicas 0   # back to $0 idle
```

## View logs

```bash
# Live api logs (console → Log Analytics):
az containerapp logs show -n ledgerlens-api -g rg-ledgerlens --follow
# Migrate job's last run:
az containerapp job logs show -n ledgerlens-migrate -g rg-ledgerlens --container migrate --tail 40
```

## View traces (Application Insights) — the AI-native money shot

Telemetry is emitted only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set (it is, on
the api, as an ACA secret). Manual spans land in the **`dependencies`** table (type
`InProc`); the cost/turns histograms land in **`customMetrics`**; HTTP requests in
**`requests`**; 5xx faults in **`exceptions`**.

Portal: Application Insights → **Transaction search** (find an `agent.ask`, expand to see
its child `agent.tool …` spans) or **Application map**.

CLI (needs `az extension add -n application-insights`):

```bash
APPID=$(az monitor app-insights component show -g rg-ledgerlens -a ledgerlens-appi --query appId -o tsv)
az monitor app-insights query --app "$APPID" --analytics-query '<KQL below>'
```

KQL snippets:

```kusto
// Agent runs: model, turns, tool count, stop reason, duration.
dependencies
| where name == "agent.ask"
| project timestamp, duration,
          model      = tostring(customDimensions["agent.model"]),
          turns      = toint(customDimensions["agent.turns"]),
          tools      = toint(customDimensions["agent.tool_count"]),
          stopReason = tostring(customDimensions["agent.stop_reason"])
| order by timestamp desc

// Per-tool spans: name, ok, api-observed latency (NOT in-DB time — ADR-0013).
dependencies
| where name startswith "agent.tool "
| project timestamp, tool = tostring(customDimensions["tool.name"]),
          ok = tostring(customDimensions["tool.ok"]), latency_ms = duration
| order by timestamp desc

// Cost + turns metrics (customMetrics histograms).
customMetrics
| where name in ("agent.cost_usd", "agent.turns")
| summarize avg(value), sum(value), count() by name, bin(timestamp, 1h)

// SSE lifecycle (attributes on the streaming request span).
requests
| where url endswith "/ask/stream"
| project timestamp, duration,
          frames     = toint(customDimensions["sse.frames"]),
          firstMs    = toint(customDimensions["sse.first_event_ms"]),
          endReason  = tostring(customDimensions["sse.end_reason"])
| order by timestamp desc
```

## Teardown

```bash
az group delete -n rg-ledgerlens --yes --no-wait
```

## Cost posture (spec 0007 §8)

Idle ≈ ACR Basic (~$5/mo) + Postgres B1ms **stopped** (~$4/mo storage); both apps scale to
zero; App Insights/Log Analytics ingestion is minimal on this low-traffic demo. Running
Postgres is ~$16/mo — stop it when idle. The subscription is hard-capped at $100.
