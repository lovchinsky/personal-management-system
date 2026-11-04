import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { optionalPort } from '../platform/di/optional-port';
import { RunRowsModule } from '../runs/run-rows.module';
import { continuationsConfig } from './continuations.config';
import { ContinuationsService } from './continuations.service';
import { ScheduledCheckRepository } from './scheduled-check.repository';
import { ScheduledCheckRunSource } from './scheduled-check.run-source';
import {
  AbsentWakeFailureNotice,
  WAKE_FAILURE_NOTICE,
  WAKE_FAILURE_NOTICE_ADAPTER,
  type WakeFailureNotice,
} from './wake-failure-notice';
import { WakeFailureWorker } from './wake-failure.worker';

/**
 * The continuations module brings together the capability service, `scheduled_checks`, the source
 * that takes a due check into a run and prunes the concluded ones, and the worker that tells the
 * person about a wake that did not take place. It exports the service and the run source
 * (`INV-080`).
 *
 * The module does not depend on Notion, so it comes up without a token or a binding. It knows
 * nothing of delivery: the notice goes through a port, and delivery supplies its adapter.
 */
@Module({
  imports: [ConfigModule.forFeature(continuationsConfig), RunRowsModule],
  providers: [
    ContinuationsService,
    ScheduledCheckRunSource,
    ScheduledCheckRepository,
    WakeFailureWorker,
    optionalPort<WakeFailureNotice>(
      WAKE_FAILURE_NOTICE,
      WAKE_FAILURE_NOTICE_ADAPTER,
      () => new AbsentWakeFailureNotice(),
    ),
  ],
  exports: [ContinuationsService, ScheduledCheckRunSource],
})
export class ContinuationsModule {}
