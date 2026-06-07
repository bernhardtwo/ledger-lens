/**
 * HTTP bootstrap. `reflect-metadata` MUST be imported before any Nest decorator
 * is evaluated. Express adapter (default); shutdown hooks enabled.
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const parsedPort = Number.parseInt(process.env.PORT ?? "", 10);
  const port = Number.isInteger(parsedPort) ? parsedPort : 3001;
  await app.listen(port);
}

void bootstrap();
