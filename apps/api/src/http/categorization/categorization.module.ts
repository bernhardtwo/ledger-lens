import { Module } from "@nestjs/common";
import {
  AnthropicCategorizationClient,
  DEFAULT_CATEGORIZATION_MODEL,
} from "../../categorization/anthropic-client.js";
import type { CategorizationClient } from "../../categorization/types.js";
import { DatabaseModule } from "../database/database.module.js";
import { CategorizationController } from "./categorization.controller.js";
import { CategorizationService } from "./categorization.service.js";
import { CATEGORIZATION_CLIENT } from "./categorization.tokens.js";

@Module({
  imports: [DatabaseModule],
  controllers: [CategorizationController],
  providers: [
    CategorizationService,
    {
      // The real client builds its SDK lazily, so app boot needs no API key;
      // tests override this token with a mock (no real API call anywhere).
      provide: CATEGORIZATION_CLIENT,
      useFactory: (): CategorizationClient =>
        new AnthropicCategorizationClient(
          process.env.ANTHROPIC_API_KEY,
          process.env.ANTHROPIC_CATEGORIZATION_MODEL ?? DEFAULT_CATEGORIZATION_MODEL,
        ),
    },
  ],
})
export class CategorizationModule {}
