import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AccountsModule } from "./accounts/accounts.module.js";
import { AskModule } from "./ask/ask.module.js";
import { CategorizationModule } from "./categorization/categorization.module.js";
import { HttpExceptionsFilter } from "./common/http-exceptions.filter.js";
import { HealthModule } from "./health/health.module.js";
import { StatementsModule } from "./statements/statements.module.js";
import { TransactionsModule } from "./transactions/transactions.module.js";

/**
 * Root module. The domain-error filter is registered as `APP_FILTER` (not via
 * `app.useGlobalFilters` in main.ts) so it is also active under the e2e testing
 * harness, which never runs `main.ts`.
 */
@Module({
  imports: [
    HealthModule,
    AccountsModule,
    StatementsModule,
    TransactionsModule,
    CategorizationModule,
    AskModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionsFilter }],
})
export class AppModule {}
