import { Test, TestingModule } from '@nestjs/testing';
import { APIErrorCode, Client } from '@notionhq/client';
import { subMilliseconds } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { ActionExecutor } from '../../src/approvals/executor/action.executor';
import { executorConfig } from '../../src/approvals/executor/executor.config';
import { ExecutorWorker } from '../../src/approvals/executor/executor.worker';
import { PreconditionEvaluator } from '../../src/approvals/preconditions/precondition.evaluator';
import { ProposalFate } from '../../src/approvals/proposal-notice';
import { ProposalPublisher } from '../../src/approvals/publication/proposal.publisher';
import { PublicationWorker } from '../../src/approvals/publication/publication.worker';
import { appConfig, type AppConfig } from '../../src/config/app.config';
import { PendingAction } from '../../src/generated/prisma/client';
import { ChannelReply } from '../../src/intake/channel/channel-reply';
import { IntentRouter } from '../../src/intake/channel/intent.router';
import { BotIdentity } from '../../src/notion/client/bot-identity';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { PageReader } from '../../src/notion/client/page.reader';
import { CanonicalWriteRequest } from '../../src/notion/semantics/canonical-write';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { Actor } from '../../src/runs/actor';
import { notionAnswer } from '../fixtures/notion-answer.fixture';
import { INTEGRATION_BOT } from '../fixtures/notion-bot';
import { TASK_STATUS_ID } from '../fixtures/notion-mapping.fixture';
import { NOTICE_PROVIDER, RecordingNotice } from '../fixtures/proposal-notice';
import { proposeAs } from '../fixtures/propose-as';
import {
  NEXT_ACTION,
  Note,
  TASK_PAGE_ID,
  TASK_STATUS_LIVE,
  TasksInNotion,
} from '../fixtures/tasks-in-notion';
import { FRESH_RECEIPT } from '../fixtures/telegram';
import { bindingProvider, testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

/**
 * `INV-107` A proposal's fate is recorded in its thread as a system write exactly once per
 * transition: the person's decision — approval or rejection — and the non-execution of what was
 * approved; execution and expiry are not written to the thread. The message about the proposal is
 * rewritten by the same step (ADR 0043).
 *
 * Everything is real except Notion, its schema and the bot's identity: the proposal, the decision
 * by button, the executor, publication, the write boundary, the adapter over the binding and the
 * database.
 */
const THREAD = 'discussion-1';

const DONE: CanonicalWriteRequest = { kind: 'option', option: 'Done' };

const AUTONOMOUS: Actor = {
  kind: 'run',
  runId: 'run-1',
  mode: 'event_evaluation',
  provenance: { origin: 'evaluation_window' },
  startedAt: new Date(),
};

/**
 * An installation with the grammatical gender `feminine` for addressing the owner (ADR 0046): the
 * decision trail takes the gender from the setting and does not guess it. The default value, with
 * no gender forms, is covered by `proposal-restart.spec.ts`.
 */
const APP: AppConfig = {
  port: 3000,
  timeZone: 'Europe/Kyiv',
  language: 'uk',
  ownerGender: 'feminine',
};

describe("INV-107 a proposal's fate is recorded in its thread", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let approvals: ApprovalsService;
  let router: IntentRouter;
  let executor: ExecutorWorker;
  let publication: PublicationWorker;
  const notion = new TasksInNotion();
  const notice: RecordingNotice = NOTICE_PROVIDER.useValue;

  beforeAll(async () => {
    const identity: Pick<BotIdentity, 'require'> = {
      require: () => Promise.resolve(INTEGRATION_BOT),
    };
    const schema: Pick<LiveSchema, 'of'> = { of: () => Promise.resolve(TASK_STATUS_LIVE) };

    moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, executorConfig, workersConfig)],
      providers: [
        { provide: appConfig.KEY, useValue: APP },
        PrismaService,
        ApprovalsService,
        PendingActionRepository,
        PreconditionEvaluator,
        ActionExecutor,
        ExecutorWorker,
        ProposalPublisher,
        PublicationWorker,
        IntentRouter,
        { provide: ChannelReply, useValue: {} },
        NOTICE_PROVIDER,
        PageReader,
        NotionWriter,
        SemanticAdapter,
        bindingProvider(),
        { provide: LiveSchema, useValue: schema },
        { provide: Client, useValue: notion },
        { provide: BotIdentity, useValue: identity },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    approvals = moduleRef.get(ApprovalsService);
    router = moduleRef.get(IntentRouter);
    executor = moduleRef.get(ExecutorWorker);
    publication = moduleRef.get(PublicationWorker);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    notion.reset();
    notice.told.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** `null` means a proposal without a thread. */
  const propose = (discussionId: string | null = THREAD): Promise<PendingAction> =>
    proposeAs(approvals, AUTONOMOUS, {
      ...(discussionId === null ? {} : { discussionId }),
      effects: [
        { kind: 'property_write', pageId: TASK_PAGE_ID, propertyId: TASK_STATUS_ID, value: DONE },
      ],
      preconditions: [
        {
          kind: 'property_equals',
          pageId: TASK_PAGE_ID,
          propertyId: TASK_STATUS_ID,
          optionId: NEXT_ACTION,
        },
      ],
    });

  const press = (kind: 'approve' | 'reject', id: string): Promise<unknown> =>
    router.route({ kind, pendingActionId: id }, FRESH_RECEIPT);

  const SCHVALYLA: Note = {
    discussion_id: THREAD,
    text: 'Ти схвалила: статус → Готово.',
    label: 'Твоє рішення',
  };

  it('an approval leaves the trail “схвалила” in the thread, and an execution only a message', async () => {
    const { id } = await propose();

    await press('approve', id);

    // The decision is only recorded: no trail and no message until the publication tick.
    expect(notion.notes).toEqual([]);
    expect(notice.told).toEqual([]);

    await publication.runOnce();
    await executor.runOnce();
    await publication.runOnce();

    const told: [string, ProposalFate][] = [
      [id, 'approved'],
      [id, 'executed'],
    ];

    expect(notion.notes).toEqual([SCHVALYLA]);
    expect(notice.told).toEqual(told);
  });

  it('a rejection leaves the trail “відхилила” in the thread', async () => {
    const { id } = await propose();

    await press('reject', id);
    await publication.runOnce();

    const expected: Note[] = [
      {
        discussion_id: THREAD,
        text: 'Ти відхилила: статус → Готово.',
        label: 'Твоє рішення',
      },
    ];

    expect(notion.notes).toEqual(expected);
    expect(notice.told).toEqual([[id, 'rejected']]);
  });

  it('approved, but the state has changed: “схвалила” and “не записано” with a reason', async () => {
    const { id } = await propose();

    await press('approve', id);
    notion.personSets('opt_waiting_for', 'Waiting For');
    await executor.runOnce();
    await publication.runOnce();

    const expected: Note[] = [
      SCHVALYLA,
      {
        discussion_id: THREAD,
        text: 'Схвалену зміну не записано (статус → Готово): сторінка встигла змінитися після пропозиції.',
        label: 'Результат зміни',
      },
    ];

    expect(notion.notes).toEqual(expected);
    expect(notice.told).toEqual([[id, 'conflict']]);
  });

  it('a refusal of access after the limit: “не записано: немає доступу”', async () => {
    const { id } = await propose();

    await press('approve', id);
    await publication.runOnce();
    notion.refusal = notionAnswer(APIErrorCode.RestrictedResource, 403);

    for (let attempt = 0; attempt < executorConfig().noAccessMaxAttempts; attempt += 1) {
      await prisma.pendingAction.updateMany({
        data: { nextAttemptAt: subMilliseconds(new Date(), 1) },
      });
      await executor.runOnce();
    }

    await publication.runOnce();

    expect(notion.notes.at(-1)).toEqual({
      discussion_id: THREAD,
      text: 'Схвалену зміну не записано (статус → Готово): у системи немає доступу до сторінки.',
      label: 'Результат зміни',
    });
    expect(notice.told.at(-1)).toEqual([id, 'failed']);
  });

  it('republishing the same transition writes nothing', async () => {
    const { id } = await propose();

    await press('approve', id);
    await publication.runOnce();
    await publication.runOnce();

    expect(notion.notes).toEqual([SCHVALYLA]);
    expect(notice.told).toEqual([[id, 'approved']]);
  });

  /** A temporary Notion refusal is no reason to lose the trail: the next tick will write it. */
  it('a temporary refusal of the comment: the fate waits and is published on the next tick', async () => {
    const { id } = await propose();

    await press('approve', id);
    notion.commentRefusal = notionAnswer(APIErrorCode.ServiceUnavailable, 503);
    await publication.runOnce();

    expect(notice.told).toEqual([]);

    notion.commentRefusal = null;
    await publication.runOnce();

    expect(notion.notes).toEqual([SCHVALYLA]);
    expect(notice.told).toEqual([[id, 'approved']]);
  });

  /**
   * A thread that can no longer be written to stays without a trail, but the fate is published.
   * The write is not retried endlessly.
   */
  it('a thread that cannot be written to: the fate is published without a trail', async () => {
    const { id } = await propose();

    await press('approve', id);
    notion.commentRefusal = notionAnswer(APIErrorCode.ObjectNotFound, 404);
    await publication.runOnce();
    await publication.runOnce();

    expect(notion.notes).toEqual([]);
    expect(notice.told).toEqual([[id, 'approved']]);
  });

  it('an expired proposal gets only a message', async () => {
    const { id } = await propose();

    await approvals.lapseShown([id]);
    await publication.runOnce();

    expect(notion.notes).toEqual([]);
    expect(notice.told).toEqual([[id, 'expired']]);
  });

  it('a proposal without a thread gets only a message', async () => {
    const { id } = await propose(null);

    await press('approve', id);
    await publication.runOnce();

    expect(notion.notes).toEqual([]);
    expect(notice.told).toEqual([[id, 'approved']]);
  });
});
