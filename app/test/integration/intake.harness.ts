import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@notionhq/client';
import { subMilliseconds } from 'date-fns';
import { z } from 'zod';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { PreconditionEvaluator } from '../../src/approvals/preconditions/precondition.evaluator';
import { AttentionService } from '../../src/attention/attention.service';
import { SystemDiscussionRepository } from '../../src/attention/system-discussion.repository';
import { appConfig } from '../../src/config/app.config';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { NotionAuthorship } from '../../src/intake/notion/authorship';
import { evaluationWindowConfig } from '../../src/intake/notion/evaluation-window.config';
import { EvaluationWindowRepository } from '../../src/intake/notion/evaluation-window.repository';
import { EvaluationWindowRunSource } from '../../src/intake/notion/evaluation-window.run-source';
import { NotionEvent, notionEventSchema } from '../../src/intake/notion/notion-event.schema';
import { NotionIntake } from '../../src/intake/notion/notion-intake';
import { RelevanceGate } from '../../src/intake/notion/relevance.gate';
import { WebhookReceiptRepository } from '../../src/intake/receipts/webhook-receipt.repository';
import { WebhookReceipts } from '../../src/intake/receipts/webhook-receipts';
import { BindingFile } from '../../src/notion/binding/binding.schema';
import { BotIdentity } from '../../src/notion/client/bot-identity';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { PageReader } from '../../src/notion/client/page.reader';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunBudget } from '../../src/runs/run-budget';
import { RUN_EFFECTS } from '../../src/runs/run-effects';
import { RunGates } from '../../src/runs/run-gates';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { RUN_SOURCES, RunCandidate } from '../../src/runs/run-source';
import { RunTraceRepository } from '../../src/runs/run-trace.repository';
import { RunDispatcher } from '../../src/runs/run.dispatcher';
import { RUN_LAUNCHER } from '../../src/runs/run.launcher';
import { RunScheduler } from '../../src/runs/run.scheduler';
import { runsConfig } from '../../src/runs/runs.config';
import { BREAKER_NOTICE_PROVIDER } from '../fixtures/breaker-notice';
import {
  TASK_STATUS_ID,
  TASK_STATUS_SPELLED,
  VALID_BINDING_FILE,
} from '../fixtures/notion-mapping.fixture';
import { NOTION_WAIT_NOTICE_PROVIDER } from '../fixtures/notion-wait-notice';
import { NOTICE_PROVIDER } from '../fixtures/proposal-notice';
import { RecordingEffects } from '../fixtures/recording-effects';
import { bindingProvider, testConfig } from '../fixtures/test-module';
import { WritingNotion } from '../fixtures/writing-notion';
import { truncateAll } from './database';
import { RecordingLauncher } from './recording-launcher';

export const OUR_BOT = '850ff178-bot';
export const A_PERSON = '61313cf4-person';

/**
 * The identifiers of the binding fixture that the intake tests use.
 *
 * The watched property appears on the wire in the percent-encoded form that Notion's official
 * example shows, and in the canonical form in which the database holds it.
 */
export const WATCHED_PROPERTY = TASK_STATUS_SPELLED;
export const WATCHED_ID = TASK_STATUS_ID;

/**
 * A watched property whose id the binding holds percent-encoded, in both forms in which an event
 * may deliver it, because the form on the wire is not measured.
 */
export const ENCODED_PROPERTY = 'r_task%7Bdependencies';
export const ENCODED_PROPERTY_RAW = 'r_task{dependencies';
export const IGNORED_PROPERTY = 'p_task_name';

export interface IntakeHarness {
  readonly moduleRef: TestingModule;
  readonly prisma: PrismaService;
  readonly intake: NotionIntake;
  readonly windows: EvaluationWindowRepository;
  /** The windows as a run queue: the claim and the disposition of a row around a run. */
  readonly windowRuns: EvaluationWindowRunSource;
  /** The system's attention over the same database: a comment and the threads it manages. */
  readonly attention: AttentionService;
  /** The Notion that attention writes comments to. */
  readonly notion: WritingNotion;
  /** A scheduler over a single source, the windows; the test ticks it by hand. */
  readonly scheduler: RunScheduler;
  readonly launcher: RecordingLauncher;
  readonly effects: RecordingEffects;
  readonly traces: RunTraceRepository;
  /**
   * Returns the windows that are due. The test does not wait out the quiet period but moves the
   * window end.
   */
  ripe(): Promise<RunCandidate[]>;
  /**
   * Brings the harness back to the “just started” state: empty database, doubles reset. The
   * harness exists from `beforeAll` on.
   */
  reset(): Promise<void>;
  /** Closes the harness module together with its connections. */
  close(): Promise<void>;
}

/** Who we are to Notion: by default, the known bot. */
const KNOWN: Pick<BotIdentity, 'require'> = { require: () => Promise.resolve(OUR_BOT) };

/**
 * Builds the harness for event intake against a live database.
 *
 * Only the edges are stubbed: the binding (the installation file; in tests, a typed fixture), the
 * model run and the App's side of the run. Everything in between is real, including the partial
 * indexes that enforce deduplication and the merging of windows.
 */
export async function buildIntakeHarness(
  file: BindingFile = VALID_BINDING_FILE,
  identity: Pick<BotIdentity, 'require'> = KNOWN,
): Promise<IntakeHarness> {
  const launcher = new RecordingLauncher();
  const effects = new RecordingEffects();
  const notion = new WritingNotion(OUR_BOT);

  const moduleRef = await Test.createTestingModule({
    imports: [
      testConfig(
        databaseConfig,
        appConfig,
        budgetConfig,
        runsConfig,
        evaluationWindowConfig,
        workersConfig,
      ),
    ],
    providers: [
      PrismaService,
      RunTraceRepository,
      RunBudget,
      RunGates,
      BREAKER_NOTICE_PROVIDER,
      NOTION_WAIT_NOTICE_PROVIDER,
      RunDispatcher,
      RunScheduler,
      WebhookReceiptRepository,
      WebhookReceipts,
      RelevanceGate,
      NotionAuthorship,
      RunRowPolicy,
      EvaluationWindowRepository,
      EvaluationWindowRunSource,
      {
        provide: RUN_SOURCES,
        inject: [EvaluationWindowRunSource],
        useFactory: (windows: EvaluationWindowRunSource) => [windows],
      },
      NotionIntake,
      AttentionService,
      SystemDiscussionRepository,
      NotionWriter,
      ContinuationsService,
      ScheduledCheckRepository,
      ApprovalsService,
      NOTICE_PROVIDER,
      PendingActionRepository,
      PreconditionEvaluator,
      PageReader,
      { provide: Client, useValue: notion },
      { provide: RUN_LAUNCHER, useValue: launcher },
      { provide: RUN_EFFECTS, useValue: effects },
      SemanticAdapter,
      bindingProvider(file),
      { provide: BotIdentity, useValue: identity },
    ],
  }).compile();

  await moduleRef.init();

  const prisma = moduleRef.get(PrismaService);
  const windowRuns = moduleRef.get(EvaluationWindowRunSource);

  return {
    moduleRef,
    prisma,
    intake: moduleRef.get(NotionIntake),
    windows: moduleRef.get(EvaluationWindowRepository),
    windowRuns,
    attention: moduleRef.get(AttentionService),
    notion,
    scheduler: moduleRef.get(RunScheduler),
    traces: moduleRef.get(RunTraceRepository),
    launcher,
    effects,
    ripe: async () => {
      await prisma.evaluationWindow.updateMany({
        data: { notBefore: subMilliseconds(new Date(), 1) },
      });

      return windowRuns.candidates();
    },
    reset: async () => {
      await truncateAll(prisma);
      launcher.reset();
      effects.reset();
      notion.reset();
    },
    close: () => moduleRef.close(),
  };
}

let sequence = 0;

/** An event on the wire, before the translation that the webhook schema performs. */
export type WireEvent = z.input<typeof notionEventSchema>;

/**
 * Builds an event with measured field names, parsed by the same schema as at the webhook's
 * ingress. An event built around that schema would not check the property ID translation. The
 * author is a person by default.
 */
export function propertyEvent(overrides: Partial<WireEvent> = {}): NotionEvent {
  sequence += 1;

  return notionEventSchema.parse({
    id: `evt-${sequence}`,
    type: 'page.properties_updated',
    timestamp: new Date().toISOString(),
    entity: { id: 'page-1', type: 'page' },
    authors: [{ id: A_PERSON, type: 'person' }],
    attempt_number: 1,
    subscription_id: 'sub-1',
    data: { updated_properties: [WATCHED_PROPERTY] },
    ...overrides,
  });
}

/** Builds the event for a person's comment in a thread of page `page-1`, as Notion delivers it. */
export function commentEvent(
  discussionId: string,
  overrides: Partial<WireEvent> = {},
): NotionEvent {
  sequence += 1;

  return notionEventSchema.parse({
    id: `evt-${sequence}`,
    type: 'comment.created',
    timestamp: new Date().toISOString(),
    entity: { id: `comment-${sequence}`, type: 'comment' },
    authors: [{ id: A_PERSON, type: 'person' }],
    attempt_number: 1,
    subscription_id: 'sub-1',
    data: { page_id: 'page-1', discussion_id: discussionId },
    ...overrides,
  });
}

/**
 * Builds the event for a page the person created in data source `dataSourceId`, as Notion delivers
 * it.
 */
export function pageCreatedEvent(
  dataSourceId: string,
  overrides: Partial<WireEvent> = {},
): NotionEvent {
  sequence += 1;

  return notionEventSchema.parse({
    id: `evt-${sequence}`,
    type: 'page.created',
    timestamp: new Date().toISOString(),
    entity: { id: 'page-1', type: 'page' },
    authors: [{ id: A_PERSON, type: 'person' }],
    attempt_number: 1,
    subscription_id: 'sub-1',
    data: { parent: { id: dataSourceId, type: 'data_source', data_source_id: dataSourceId } },
    ...overrides,
  });
}
