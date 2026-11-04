import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AttentionModule } from '../attention/attention.module';
import { ContinuationsModule } from '../continuations/continuations.module';
import { NotionIntakeModule } from '../intake/notion/notion-intake.module';
import { NotionModule } from '../notion/notion.module';
import { RunsModule } from '../runs/runs.module';
import { ReconciliationRepository } from './reconciliation.repository';
import { ReconciliationWorker } from './reconciliation.worker';
import { ResolutionReconciler } from './resolution.reconciler';
import { SafetySweep } from './safety-sweep';
import { SweepMarkRepository } from './sweep-mark.repository';
import { sweepConfig } from './sweep.config';
import { SweepFinder } from './sweep.finder';
import { SweepWorker } from './sweep.worker';

/**
 * The App's work driven by the passage of time: the periodic safety sweep and resolved-thread
 * reconciliation. Both are deterministic passes with no conclusions about the domain: the sweep
 * asks for a recheck of a page, the reconciliation for the closure of a thread, and a run decides.
 * The module exports the passes through which the gate and the tests tick without the worker loop.
 */
@Module({
  imports: [
    ConfigModule.forFeature(sweepConfig),
    NotionModule,
    NotionIntakeModule,
    ContinuationsModule,
    ApprovalsModule,
    AttentionModule,
    RunsModule,
  ],
  providers: [
    SweepFinder,
    SweepMarkRepository,
    SafetySweep,
    SweepWorker,
    ReconciliationRepository,
    ResolutionReconciler,
    ReconciliationWorker,
  ],
  exports: [SafetySweep, ResolutionReconciler],
})
export class SweepsModule {}
