import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_OPTIONS, configureApp } from './app.setup';
import { appConfig, type AppConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, APP_OPTIONS);

  configureApp(app);

  // Without this call, SIGTERM kills the process without calling `onModuleDestroy`: workers do not
  // get to finish writing the row they have just claimed, and the Postgres connection is not
  // closed. A container restart is routine, not a failure. This is the process lifecycle, not the
  // perimeter. The gate handles signals itself (`gate/abort-guard.ts`), so `configureApp` does
  // not enable it.
  app.enableShutdownHooks();

  await app.listen(app.get<AppConfig>(appConfig.KEY).port);
}

void bootstrap();
