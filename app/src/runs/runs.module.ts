import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { optionalPort } from '../platform/di/optional-port';
import {
  AbsentBreakerNotice,
  BREAKER_NOTICE,
  BREAKER_NOTICE_ADAPTER,
  type BreakerNotice,
} from './breaker-notice';
import { budgetConfig } from './budget.config';
import {
  AbsentNotionWaitNotice,
  NOTION_WAIT_NOTICE,
  NOTION_WAIT_NOTICE_ADAPTER,
  type NotionWaitNotice,
} from './notion-wait-notice';
import { RunBudget } from './run-budget';
import { AbsentRunEffects, RUN_EFFECTS, RUN_EFFECTS_ADAPTER, type RunEffects } from './run-effects';
import { RunGates } from './run-gates';
import { RunTraceRepository } from './run-trace.repository';
import { RunTraces } from './run-traces';
import { RunDispatcher } from './run.dispatcher';
import {
  AbsentRunLauncher,
  RUN_LAUNCHER,
  RUN_LAUNCHER_ADAPTER,
  type RunLauncher,
} from './run.launcher';
import { runsConfig } from './runs.config';

/**
 * The runs module holds the run gates, limits, admission, the ledger, the dispatcher and three
 * ports: launch, App effects and the notice of an open breaker.
 *
 * The module exports the dispatcher, the run gates and the trace projection for reading: the
 * scheduler, which is wired over the sources in `scheduling/`, asks the gates and drives runs
 * through the dispatcher. The ledger is not exported: whoever admitted a run writes its trace, and
 * nobody else.
 *
 * Each port takes the adapter if the adapter has put itself under the port's token, and otherwise
 * stays absent. The dependency runs from the adapter to the port: `runs/` knows nothing of the
 * runner or the App MCP, and a second instance of the module is not needed for them.
 */
@Module({
  imports: [ConfigModule.forFeature(budgetConfig), ConfigModule.forFeature(runsConfig)],
  providers: [
    RunTraceRepository,
    RunTraces,
    RunBudget,
    RunGates,
    RunDispatcher,
    optionalPort<RunLauncher>(RUN_LAUNCHER, RUN_LAUNCHER_ADAPTER, () => new AbsentRunLauncher()),
    optionalPort<RunEffects>(RUN_EFFECTS, RUN_EFFECTS_ADAPTER, () => new AbsentRunEffects()),
    optionalPort<BreakerNotice>(
      BREAKER_NOTICE,
      BREAKER_NOTICE_ADAPTER,
      () => new AbsentBreakerNotice(),
    ),
    optionalPort<NotionWaitNotice>(
      NOTION_WAIT_NOTICE,
      NOTION_WAIT_NOTICE_ADAPTER,
      () => new AbsentNotionWaitNotice(),
    ),
  ],
  exports: [RunDispatcher, RunGates, RunTraces],
})
export class RunsModule {}
