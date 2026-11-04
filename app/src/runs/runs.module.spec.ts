import { Global, Module, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RecordingEffects } from '../../test/fixtures/recording-effects';
import { testConfig, unreached } from '../../test/fixtures/test-module';
import { appConfig } from '../config/app.config';
import { PrismaService } from '../platform/db/prisma.service';
import { AbsentRunEffects, RUN_EFFECTS, RUN_EFFECTS_ADAPTER, type RunEffects } from './run-effects';
import {
  AbsentRunLauncher,
  RUN_LAUNCHER,
  RUN_LAUNCHER_ADAPTER,
  type RunLauncher,
} from './run.launcher';
import { RunsModule } from './runs.module';

const launcher: RunLauncher = {
  available: true,
  readiness: () => Promise.resolve({ ready: true }),
  launch: () => Promise.reject(new Error('not launched in this test')),
};

const effects: RunEffects = new RecordingEffects();

/** The ledger pulls in a database connection; the question about the ports does not need it. */
@Global()
@Module({ providers: [unreached(PrismaService)], exports: [PrismaService] })
class NoDatabase {}

/** This is how the runner's adapter substitutes itself from outside `runs/`. */
@Global()
@Module({
  providers: [{ provide: RUN_LAUNCHER_ADAPTER, useValue: launcher }],
  exports: [RUN_LAUNCHER_ADAPTER],
})
class Runner {}

/** This is how the App MCP substitutes itself from outside `runs/`. */
@Global()
@Module({
  providers: [{ provide: RUN_EFFECTS_ADAPTER, useValue: effects }],
  exports: [RUN_EFFECTS_ADAPTER],
})
class AppMcp {}

interface Ports {
  readonly launcher: RunLauncher;
  readonly effects: RunEffects;
}

async function portsWith(...extra: Type[]): Promise<Ports> {
  const moduleRef = await Test.createTestingModule({
    imports: [testConfig(appConfig), NoDatabase, RunsModule, ...extra],
  }).compile();

  const ports: Ports = {
    launcher: moduleRef.get<RunLauncher>(RUN_LAUNCHER, { strict: false }),
    effects: moduleRef.get<RunEffects>(RUN_EFFECTS, { strict: false }),
  };

  await moduleRef.close();

  return ports;
}

describe('run ports', () => {
  it('stay absent without adapters', async () => {
    const ports = await portsWith();

    expect(ports.launcher).toBeInstanceOf(AbsentRunLauncher);
    expect(ports.effects).toBeInstanceOf(AbsentRunEffects);
  });

  /**
   * Adapters connect from outside: `runs/` does not import them, and a second instance of the
   * module is not needed for them. A second instance is what would leave the scheduler with a
   * dispatcher that has no runner.
   */
  it('pick up adapters that substituted themselves from outside', async () => {
    const ports = await portsWith(Runner, AppMcp);

    expect(ports.launcher).toBe(launcher);
    expect(ports.effects).toBe(effects);
  });

  /** An App MCP without a runner is a build with the runner switched off (ADR 0013): no runs. */
  it('build normally when an App MCP has no runner', async () => {
    const ports = await portsWith(AppMcp);

    expect(ports.launcher).toBeInstanceOf(AbsentRunLauncher);
    expect(ports.effects).toBe(effects);
  });

  it('stop the build when a runner has no App MCP', async () => {
    await expect(portsWith(Runner)).rejects.toThrow('a runner is wired without App MCP');
  });
});
