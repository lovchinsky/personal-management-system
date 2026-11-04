import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@notionhq/client';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { ActionExecutor } from '../../src/approvals/executor/action.executor';
import { executorConfig } from '../../src/approvals/executor/executor.config';
import { ExecutorWorker } from '../../src/approvals/executor/executor.worker';
import { PreconditionEvaluator } from '../../src/approvals/preconditions/precondition.evaluator';
import { PROPOSAL_NOTICE, ProposalFate } from '../../src/approvals/proposal-notice';
import { ProposalPublisher } from '../../src/approvals/publication/proposal.publisher';
import { PublicationWorker } from '../../src/approvals/publication/publication.worker';
import { appConfig } from '../../src/config/app.config';
import { PendingAction } from '../../src/generated/prisma/client';
import { ChannelReply } from '../../src/intake/channel/channel-reply';
import { IntentRouter } from '../../src/intake/channel/intent.router';
import { BotIdentity } from '../../src/notion/client/bot-identity';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { PageReader } from '../../src/notion/client/page.reader';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { Actor } from '../../src/runs/actor';
import { INTEGRATION_BOT } from '../fixtures/notion-bot';
import { TASK_STATUS_ID, TASK_STATUS_SPELLED } from '../fixtures/notion-mapping.fixture';
import { RecordingNotice } from '../fixtures/proposal-notice';
import { proposeAs } from '../fixtures/propose-as';
import {
  NEXT_ACTION,
  Note,
  TASK_PAGE_ID,
  TASK_STATUS_LIVE,
  TasksInNotion,
  Update,
} from '../fixtures/tasks-in-notion';
import { FRESH_RECEIPT } from '../fixtures/telegram';
import { bindingProvider, testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

const THREAD = 'discussion-1';

const AUTONOMOUS: Actor = {
  kind: 'run',
  runId: 'run-1',
  mode: 'event_evaluation',
  provenance: { origin: 'evaluation_window' },
  startedAt: new Date(),
};

/** One App instance: what a test sees of it. */
interface Instance {
  readonly prisma: PrismaService;
  readonly approvals: ApprovalsService;
  readonly router: IntentRouter;
  readonly executor: ExecutorWorker;
  readonly publication: PublicationWorker;
  readonly notice: RecordingNotice;
  readonly close: () => Promise<void>;
}

/**
 * A proposal survives an App restart: it lives as a row in the database, not in process memory.
 * A run proposes in one instance. That instance is closed. A fresh instance over the same
 * database accepts the button press, executes what was approved and publishes its fate.
 *
 * Everything is real except Notion, its schema and the bot's identity, as in `inv-107.spec.ts`.
 * Notion is the outside world, so it is the same for both instances; each instance has its own
 * notice port, so that the fresh one cannot lean on what the earlier one recorded.
 */
describe('a proposal survives an App restart', () => {
  const notion = new TasksInNotion();
  /** Instances the test has not closed yet: `afterEach` closes them, wherever the test fails. */
  const open = new Set<Instance>();

  async function instance(): Promise<Instance> {
    const identity: Pick<BotIdentity, 'require'> = {
      require: () => Promise.resolve(INTEGRATION_BOT),
    };
    const schema: Pick<LiveSchema, 'of'> = { of: () => Promise.resolve(TASK_STATUS_LIVE) };
    const notice = new RecordingNotice();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, appConfig, executorConfig, workersConfig)],
      providers: [
        PrismaService,
        ApprovalsService,
        PendingActionRepository,
        PreconditionEvaluator,
        ActionExecutor,
        ExecutorWorker,
        ProposalPublisher,
        PublicationWorker,
        IntentRouter,
        // A text reply is another flow: decisions here are made only with the button.
        { provide: ChannelReply, useValue: {} },
        { provide: PROPOSAL_NOTICE, useValue: notice },
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

    const created: Instance = {
      prisma: moduleRef.get(PrismaService),
      approvals: moduleRef.get(ApprovalsService),
      router: moduleRef.get(IntentRouter),
      executor: moduleRef.get(ExecutorWorker),
      publication: moduleRef.get(PublicationWorker),
      notice,
      close: async () => {
        open.delete(created);
        await moduleRef.close();
      },
    };

    open.add(created);

    return created;
  }

  beforeEach(() => {
    notion.reset();
  });

  afterEach(async () => {
    for (const left of [...open]) await left.close();
  });

  it('a fresh instance accepts the press, executes what was approved and publishes the fate', async () => {
    const before = await instance();

    await truncateAll(before.prisma);

    const proposal: PendingAction = await proposeAs(before.approvals, AUTONOMOUS, {
      discussionId: THREAD,
      effects: [
        {
          kind: 'property_write',
          pageId: TASK_PAGE_ID,
          propertyId: TASK_STATUS_ID,
          value: { kind: 'option', option: 'Done' },
        },
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

    await before.close();

    const after = await instance();

    await after.router.route({ kind: 'approve', pendingActionId: proposal.id }, FRESH_RECEIPT);
    await after.publication.runOnce();
    await expect(after.executor.runOnce()).resolves.toBe(1);
    await after.publication.runOnce();

    const written: Update[] = [
      {
        page_id: TASK_PAGE_ID,
        properties: { [TASK_STATUS_SPELLED]: { status: { id: 'opt_done' } } },
      },
    ];
    const approved: Note[] = [
      {
        discussion_id: THREAD,
        // An installation without a grammatical gender of address: the decision trail has no gender
        // forms (ADR 0046).
        text: 'Твоє рішення — схвалити: статус → Готово.',
        label: 'Твоє рішення',
      },
    ];
    const told: [string, ProposalFate][] = [
      [proposal.id, 'approved'],
      [proposal.id, 'executed'],
    ];
    const settled = await after.prisma.pendingAction.findUniqueOrThrow({
      where: { id: proposal.id },
    });

    expect(settled.status).toBe('executed');
    expect(notion.updates).toEqual(written);
    expect(notion.notes).toEqual(approved);
    expect(after.notice.told).toEqual(told);
  });
});
