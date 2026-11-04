import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ContinuationsModule } from '../continuations/continuations.module';
import { NotionIntakeModule } from '../intake/notion/notion-intake.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { RUN_SOURCES } from '../runs/run-source';
import { RunScheduler } from '../runs/run.scheduler';
import { runsConfig } from '../runs/runs.config';
import { RunsModule } from '../runs/runs.module';
import { runSourcesProvider } from './run-sources.provider';

/**
 * The run scheduler over the sources (ADR 0016).
 *
 * The module is wiring over the other modules, not part of any of them: sources belong to their
 * capabilities, the scheduler to runs, and only here do they meet. The list of sources is
 * exported: pruning reads it too.
 */
@Module({
  imports: [
    ConfigModule.forFeature(runsConfig),
    RunsModule,
    ContinuationsModule,
    NotionIntakeModule,
    ReviewsModule,
  ],
  providers: [runSourcesProvider, RunScheduler],
  exports: [RUN_SOURCES],
})
export class SchedulingModule {}
