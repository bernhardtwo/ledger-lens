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
the api, as an ACA secret). This App Insights is **workspace-based**, so telemetry lands
in the Log Analytics workspace's **`App*`** tables: manual spans in **`AppDependencies`**,
the cost/turns histograms in **`AppMetrics`** (`Sum`/`ItemCount`), HTTP requests in
**`AppRequests`**, 5xx faults in **`AppExceptions`**. (The classic
`dependencies`/`requests`/`customMetrics` aliases work in the **portal** Logs /
Transaction-search experience, but the `az monitor app-insights query` CLI does not
federate to them for a workspace-based resource — query the workspace directly instead.)

Portal: Application Insights → **Transaction search** (find an `agent.ask`, expand to see
its child `agent.tool …` spans) or **Application map**.

CLI (workspace `App*` tables; needs `az extension add -n log-analytics`):

```bash
WS=$(az monitor log-analytics workspace show -g rg-ledgerlens -n ledgerlens-law --query customerId -o tsv)
az monitor log-analytics query -w "$WS" --analytics-query '<KQL below>'
```

KQL snippets:

```kusto
// Agent runs: model, turns, tool count, cost (server-side), stop reason, duration.
AppDependencies
| where Name == "agent.ask"
| project TimeGenerated, DurationMs,
          streaming  = tostring(Properties["agent.streaming"]),
          model      = tostring(Properties["agent.model"]),
          turns      = toint(Properties["agent.turns"]),
          tools      = toint(Properties["agent.tool_count"]),
          cost_usd   = todouble(Properties["agent.cost_usd"]),
          stopReason = tostring(Properties["agent.stop_reason"])
| order by TimeGenerated desc

// Per-tool spans: name, ok, api-observed latency (NOT in-DB time — ADR-0013).
AppDependencies
| where Name startswith "agent.tool "
| project TimeGenerated, tool = tostring(Properties["tool.name"]),
          ok = tostring(Properties["tool.ok"]), latency_ms = DurationMs
| order by TimeGenerated desc

// Cost + turns metrics (OTel histograms → Sum / ItemCount).
AppMetrics
| where Name in ("agent.cost_usd", "agent.turns")
| summarize runs = sum(ItemCount), total = round(sum(Sum), 5) by Name

// SSE lifecycle (attributes on the streaming request span).
AppRequests
| where Url has "ask/stream"
| project TimeGenerated, DurationMs,
          frames    = toint(Properties["sse.frames"]),
          firstMs   = toint(Properties["sse.first_event_ms"]),
          endReason = tostring(Properties["sse.end_reason"])
| order by TimeGenerated desc
```

## Teardown

```bash
az group delete -n rg-ledgerlens --yes --no-wait
```

## Cost posture (spec 0007 §8)

Idle ≈ ACR Basic (~$5/mo) + Postgres B1ms **stopped** (~$4/mo storage); both apps scale to
zero; App Insights/Log Analytics ingestion is minimal on this low-traffic demo. Running
Postgres is ~$16/mo — stop it when idle. The subscription is hard-capped at $100.
