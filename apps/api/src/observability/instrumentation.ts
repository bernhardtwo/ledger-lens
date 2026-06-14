/**
 * OpenTelemetry bootstrap (ADR-0013, spec 0007 §6.1). Loaded via `node --import` BEFORE
 * the Nest app so the Azure Monitor distro can patch `http`/`express` before they load
 * (see the api Dockerfile CMD).
 *
 * GATING GUARDRAIL: this is a NO-OP unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is
 * set. With no connection string `useAzureMonitor` is never called, no OTel SDK is
 * registered, and every `@opentelemetry/api` call elsewhere is a no-op — so local dev,
 * the unit/integration suites, and the eval run with zero telemetry and no behaviour
 * change. The distro's exporter batches asynchronously; telemetry is never awaited in a
 * request path, so the SSE stream stays un-buffered (the 2c gate).
 */
import { useAzureMonitor } from "@azure/monitor-opentelemetry";

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString !== undefined && connectionString !== "") {
  // The distro reads the connection string from APPLICATIONINSIGHTS_CONNECTION_STRING.
  useAzureMonitor();
}
