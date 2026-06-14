import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

/** Liveness probe module (ADR-0011). No providers — the controller is self-contained. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
