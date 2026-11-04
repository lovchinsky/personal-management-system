import { Test } from '@nestjs/testing';
import { APIErrorCode } from '@notionhq/client';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { AttentionService } from '../../src/attention/attention.service';
import { SystemDiscussionRepository } from '../../src/attention/system-discussion.repository';
import { appConfig } from '../../src/config/app.config';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { evaluationWindowConfig } from '../../src/intake/notion/evaluation-window.config';
import { EvaluationWindowRepository } from '../../src/intake/notion/evaluation-window.repository';
import { CommentsReader } from '../../src/notion/client/comments.reader';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { PageReader } from '../../src/notion/client/page.reader';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunBudget } from '../../src/runs/run-budget';
import { RunGates } from '../../src/runs/run-gates';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { RunTraceRepository } from '../../src/runs/run-trace.repository';
import { RunTraces } from '../../src/runs/run-traces';
import { RUN_LAUNCHER } from '../../src/runs/run.launcher';
import { runsConfig } from '../../src/runs/runs.config';
import { ReconciliationRepository } from '../../src/sweeps/reconciliation.repository';
import { ResolutionReconciler } from '../../src/sweeps/resolution.reconciler';
import { SafetySweep } from '../../src/sweeps/safety-sweep';
import { SweepMarkRepository } from '../../src/sweeps/sweep-mark.repository';
import { sweepConfig } from '../../src/sweeps/sweep.config';
import { Candidate, SweepFinder } from '../../src/sweeps/sweep.finder';
import { BREAKER_NOTICE_PROVIDER } from '../fixtures/breaker-notice';
import { notionAnswer } from '../fixtures/notion-answer.fixture';
import { NOTION_WAIT_NOTICE_PROVIDER } from '../fixtures/notion-wait-notice';
import { testConfig, unreached } from '../fixtures/test-module';
import { RecordingLauncher } from './recording-launcher';

/** Candidates the test supplies to the sweep instead of queries to Notion. */
class StagedFinder implements Pick<SweepFinder, 'find'> {
  candidates: Candidate[] = [];
  /** How many times a tick asked for candidates, that is, read Notion. */
  asked = 0;

  find(): Promise<Candidate[]> {
    this.asked += 1;

    return Promise.resolve(this.candidates);
  }
}

/**
 * Notion for the reconciliation: the unresolved threads of each anchor and the comments that are
 * still readable.
 */
class StagedComments implements Pick<CommentsReader, 'openDiscussions' | 'exists'> {
  /** Anchor → unresolved threads. An anchor absent here does not exist for the integration. */
  readonly open = new Map<string, string[]>();
  /** Comments Notion still reads, including those in resolved threads. */
  readonly readable = new Set<string>();
  /** The anchors the reconciliation asked about, in order. */
  readonly asked: string[] = [];
  /** A Notion failure on any query while the field is set. */
  failure?: Error;
  /** A failure on the query about one anchor: the other anchors are read. */
  readonly failing = new Map<string, Error>();

  openDiscussions(anchor: string): Promise<ReadonlySet<string>> {
    this.asked.push(anchor);

    const failure = this.failure ?? this.failing.get(anchor);

    if (failure !== undefined) return Promise.reject(failure);

    const open = this.open.get(anchor);

    return open
      ? Promise.resolve(new Set(open))
      : Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404));
  }

  exists(commentId: string): Promise<boolean> {
    if (this.failure !== undefined) return Promise.reject(this.failure);

    return Promise.resolve(this.readable.has(commentId));
  }

  reset(): void {
    this.open.clear();
    this.readable.clear();
    this.asked.length = 0;
    this.failure = undefined;
    this.failing.clear();
  }
}

export interface SweepsWorld {
  readonly prisma: PrismaService;
  readonly sweep: SafetySweep;
  readonly reconciler: ResolutionReconciler;
  readonly continuations: ContinuationsService;
  readonly checks: ScheduledCheckRunSource;
  readonly finder: StagedFinder;
  readonly comments: StagedComments;
  readonly launcher: RecordingLauncher;
  readonly close: () => Promise<void>;
}

/**
 * Builds the sweep and the reconciliation over a real database. The continuation queue, the
 * windows, the proposals, the registry of discussions and the run ledger are real, while Notion
 * is stubbed by the test.
 */
export async function sweepsWorld(): Promise<SweepsWorld> {
  const finder = new StagedFinder();
  const comments = new StagedComments();
  const launcher = new RecordingLauncher();
  const moduleRef = await Test.createTestingModule({
    imports: [
      testConfig(
        databaseConfig,
        appConfig,
        budgetConfig,
        runsConfig,
        evaluationWindowConfig,
        sweepConfig,
      ),
    ],
    providers: [
      PrismaService,
      ScheduledCheckRepository,
      ContinuationsService,
      RunRowPolicy,
      ScheduledCheckRunSource,
      PendingActionRepository,
      {
        provide: ApprovalsService,
        inject: [PendingActionRepository],
        useFactory: (actions: PendingActionRepository): Partial<ApprovalsService> => ({
          hasOpenFor: (id) => actions.hasOpenOn(id),
          hasOpenOnPage: (id) => actions.hasOpenOnPage(id),
          openDiscussions: () => actions.openDiscussions(),
        }),
      },
      SystemDiscussionRepository,
      AttentionService,
      unreached(NotionWriter),
      unreached(PageReader),
      unreached(SemanticAdapter),
      EvaluationWindowRepository,
      RunTraceRepository,
      RunTraces,
      RunBudget,
      RunGates,
      BREAKER_NOTICE_PROVIDER,
      NOTION_WAIT_NOTICE_PROVIDER,
      { provide: RUN_LAUNCHER, useValue: launcher },
      SweepMarkRepository,
      { provide: SweepFinder, useValue: finder },
      SafetySweep,
      ReconciliationRepository,
      { provide: CommentsReader, useValue: comments },
      ResolutionReconciler,
    ],
  }).compile();

  await moduleRef.init();

  return {
    prisma: moduleRef.get(PrismaService),
    sweep: moduleRef.get(SafetySweep),
    reconciler: moduleRef.get(ResolutionReconciler),
    continuations: moduleRef.get(ContinuationsService),
    checks: moduleRef.get(ScheduledCheckRunSource),
    finder,
    comments,
    launcher,
    close: () => moduleRef.close(),
  };
}
