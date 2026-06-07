import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { StatementsController } from "./statements.controller.js";
import { StatementsService } from "./statements.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [StatementsController],
  providers: [StatementsService],
})
export class StatementsModule {}
