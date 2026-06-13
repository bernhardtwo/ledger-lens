import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { AccountsController } from "./accounts.controller.js";
import { AccountsService } from "./accounts.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
