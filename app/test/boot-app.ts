import { InjectionToken } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { APP_OPTIONS, configureApp } from '../src/app.setup';
import { LOOPBACK_HOST } from '../src/mcp/server/app-mcp.address';
import { BotIdentity } from '../src/notion/client/bot-identity';

/** A provider of the production application and what the test puts in its place. */
interface Substitute {
  readonly provide: InjectionToken;
  readonly useValue: unknown;
}

interface Boot {
  /** What to substitute for production providers, in addition to the bot identity. */
  readonly substitutes?: readonly Substitute[];
  /** The loopback port the application listens on. Without it the application only initializes. */
  readonly port?: number;
}

/**
 * The bot identity is requested from Notion at startup, and with the lane's token that answer is a
 * refusal that arrives after the tests have finished. The perimeter the e2e checks does not need
 * it, so the network call is always stubbed.
 */
const NO_IDENTITY: Pick<BotIdentity, 'onApplicationBootstrap' | 'resolve'> = {
  onApplicationBootstrap: () => undefined,
  resolve: () => Promise.resolve(undefined),
};

/**
 * Boots the whole application with the same perimeter as the production process (`configureApp`).
 * Otherwise something other than the application would be tested.
 */
export async function bootApp({
  substitutes = [],
  port,
}: Boot = {}): Promise<NestExpressApplication> {
  const builder = substitutes.reduce(
    (current, { provide, useValue }) => current.overrideProvider(provide).useValue(useValue),
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BotIdentity)
      .useValue(NO_IDENTITY),
  );
  const app = (await builder.compile()).createNestApplication<NestExpressApplication>(APP_OPTIONS);

  configureApp(app);

  if (port === undefined) await app.init();
  else await app.listen(port, LOOPBACK_HOST);

  return app;
}
