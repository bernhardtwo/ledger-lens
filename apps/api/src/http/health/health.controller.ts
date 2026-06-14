/**
 * `GET /health` — liveness probe for the container platform (ADR-0011, spec 0007).
 * Deliberately dependency-free: it must return 200 even when the DB or the
 * Anthropic key are absent, so the orchestrator can distinguish "process is up"
 * from "process is unhealthy". Determinism-first (ADR-0004): it computes nothing,
 * touches no DB, and calls no LLM.
 */
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }
}
