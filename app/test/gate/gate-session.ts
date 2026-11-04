import { ConsoleLogger, LogLevel, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { APP_OPTIONS, configureApp } from '../../src/app.setup';
import { appConfig, type AppConfig } from '../../src/config/app.config';
import { LOOPBACK_HOST } from '../../src/mcp/server/app-mcp.address';
import { messageOf } from '../../src/platform/error/message-of';
import { startOfLocalDay } from '../../src/platform/time/local-day';
import { budgetConfig, type BudgetConfig } from '../../src/runs/budget.config';
import type { RunProvenance } from '../../src/runs/provenance';
import { deniedBy, RunGates } from '../../src/runs/run-gates';
import { RunTraceRepository } from '../../src/runs/run-trace.repository';
import { RUN_LAUNCHER, type RunLauncher } from '../../src/runs/run.launcher';
import { telegramConfig } from '../../src/telegram/telegram.config';
import { AbortGuard } from './abort-guard';
import { BotApi } from './bot-api';
import { gateConfig } from './gate.config';
import { RunViewsModule } from './run-views';

/**
 * How long a stopped process is allowed to finish by itself before it is forcibly terminated: a
 * model run or a connection may keep the event loop alive.
 */
const EXIT_GRACE_MS = 10_000;

/**
 * The gate application: the App, the gate settings, the run readers and the Bot API of the gate
 * environment (`bot-api.ts`). The Bot API starts and shuts down together with the application, so
 * a stop signal shuts it down too.
 */
@Module({
  imports: [
    AppModule,
    ConfigModule.forFeature(gateConfig),
    ConfigModule.forFeature(telegramConfig),
    RunViewsModule,
  ],
  providers: [BotApi],
})
class GateModule {}

/**
 * The gate logs go to stderr, because stdout belongs to the verdict, and a machine reads it.
 * `ConsoleLogger` writes everything there except errors.
 */
class StderrLogger extends ConsoleLogger {
  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
  ): void {
    super.printMessages(messages, context, logLevel, 'stderr');
  }
}

/**
 * The second App instance the gate runs on: on a loopback port, with the same HTTP perimeter as
 * the main process, and with cleanup on the operator's signal. All gate commands share it.
 */
export class GateSession {
  private constructor(
    readonly app: NestExpressApplication,
    private readonly abort: AbortGuard,
    private readonly shutdown: () => Promise<void>,
  ) {}

  static async open(gate: string): Promise<GateSession> {
    const app = await NestFactory.create<NestExpressApplication>(GateModule, {
      ...APP_OPTIONS,
      logger: new StderrLogger({ logLevels: ['error', 'warn'] }),
    });

    configureApp(app);

    const { port } = app.get<AppConfig>(appConfig.KEY);

    try {
      await app.listen(port, LOOPBACK_HOST);
    } catch (error) {
      await app.close();

      throw new Error(
        `cannot listen on ${LOOPBACK_HOST}:${port} (${messageOf(error)}): another gate may still be running in this container`,
      );
    }

    let closing: Promise<void> | undefined;
    const shutdown = (): Promise<void> => (closing ??= app.close());
    const abort = new AbortGuard(gate, {
      signals: {
        on: (signal, listener) => process.on(signal, listener),
        off: (signal, listener) => process.off(signal, listener),
      },
      close: shutdown,
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      exit: (code) => {
        process.exitCode = code;
        setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
      },
    });

    abort.arm();

    return new GateSession(app, abort, shutdown);
  }

  /** Registers the cleanup that the gate runs by itself when it is stopped by a signal. */
  holdAgainstAbort(cleanup: () => Promise<readonly string[]>): void {
    this.abort.hold(cleanup);
  }

  /**
   * Writes the gate verdict to stdout as a single document, except when the gate is being stopped
   * (`AbortGuard.report`). The document also reports the Bot API calls that the gate
   * environment's listener rejected: a foreign chat, a foreign token or a method the App does not
   * use. The verdict of every gate names them, because the listener is shared among the gates.
   */
  report(verdict: object): void {
    this.abort.report({ ...verdict, telegram: { violations: this.app.get(BotApi).violations() } });
  }

  /**
   * The gate was stopped by a signal: the guard writes the verdict stub, and the rest of the work
   * starts nothing new.
   */
  get stopping(): boolean {
    return this.abort.stopping;
  }

  /**
   * Requires the runner to be ready for the first run: without a Notion MCP grant a run has
   * nothing to work with.
   */
  async ready(): Promise<void> {
    const readiness = await this.app.get<RunLauncher>(RUN_LAUNCHER).readiness();

    if (!readiness.ready) {
      throw new Error(`the runner is not ready: ${readiness.reason}`);
    }
  }

  /**
   * Checks that a run can start right away: the plan quota is not exhausted and the slot is free.
   * The slot is held by an unfinished run (the run of an interrupted gate attempt) until its
   * ticket expires. Saying so before the scenarios is better than recording every failure as a
   * scenario error. When an origin is named, the run gates for it are taken together with the
   * autonomous ones (breaker, daily limit): a scenario that ends in an autonomous run is not
   * started if its last step would be denied.
   */
  async assertRunnable(provenance?: RunProvenance): Promise<void> {
    if (this.stopping) throw new Error('the gate was stopped by a signal');

    const state = await this.app.get(RunGates).state();
    const closed = provenance === undefined ? state.all : deniedBy(state, provenance);

    if (closed) {
      const { denial, detail, until } = closed;

      throw new Error(
        `runs are held: ${denial}${detail ? ` (${detail})` : ''}${until ? ` until ${until.toISOString()}` : ''}`,
      );
    }

    if (state.freeSlots === 0) {
      throw new Error(
        'the run slot is held by a run that did not finish; its ticket expires within fifteen minutes, then the gate can start',
      );
    }
  }

  /**
   * Returns how many autonomous runs the daily limit of `app_db_gate` still allows until the end of
   * the local day.
   */
  async autonomousRoom(): Promise<number> {
    const { dailyLimit } = this.app.get<BudgetConfig>(budgetConfig.KEY);
    const { timeZone } = this.app.get<AppConfig>(appConfig.KEY);
    const spent = await this.app
      .get(RunTraceRepository)
      .countBudgetedSince(startOfLocalDay(timeZone, new Date()));

    return Math.max(0, dailyLimit - spent);
  }

  close(): Promise<void> {
    this.abort.disarm();

    return this.shutdown();
  }
}
