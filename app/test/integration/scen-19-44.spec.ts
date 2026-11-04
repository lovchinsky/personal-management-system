import { Test, TestingModule } from '@nestjs/testing';
import { APIErrorCode, Client } from '@notionhq/client';
import { subHours, subMilliseconds } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { ActionExecutor } from '../../src/approvals/executor/action.executor';
import { executorConfig } from '../../src/approvals/executor/executor.config';
import { ExecutorWorker } from '../../src/approvals/executor/executor.worker';
import { PreconditionRequest } from '../../src/approvals/preconditions/precondition';
import { PreconditionEvaluator } from '../../src/approvals/preconditions/precondition.evaluator';
import { ActionEffectRequest } from '../../src/approvals/proposal.schema';
import { appConfig } from '../../src/config/app.config';
import { PendingAction } from '../../src/generated/prisma/client';
import { ChannelReply } from '../../src/intake/channel/channel-reply';
import { IntentRouter } from '../../src/intake/channel/intent.router';
import { BotIdentity } from '../../src/notion/client/bot-identity';
import { BotIdentityUnknownError } from '../../src/notion/client/notion.error';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { RestProperty } from '../../src/notion/client/page';
import { PageReader } from '../../src/notion/client/page.reader';
import { CanonicalWriteRequest } from '../../src/notion/semantics/canonical-write';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { InvalidRequestError } from '../../src/platform/request/invalid-request';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { Actor } from '../../src/runs/actor';
import { notionAnswer } from '../fixtures/notion-answer.fixture';
import { INTEGRATION_BOT } from '../fixtures/notion-bot';
import { TASK_STATUS_ID, TASK_STATUS_SPELLED } from '../fixtures/notion-mapping.fixture';
import {
  dateProperty,
  LAST_EDITED,
  optionProperty,
  textProperty,
} from '../fixtures/notion-page.fixture';
import { NOTICE_PROVIDER } from '../fixtures/proposal-notice';
import { proposeAs } from '../fixtures/propose-as';
import {
  A_PERSON,
  NEXT_ACTION,
  TASK_DATE_ID,
  TASK_PAGE_ID,
  TasksInNotion,
  Update,
} from '../fixtures/tasks-in-notion';
import { FRESH_RECEIPT } from '../fixtures/telegram';
import { bindingProvider, testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

/**
 * `SCEN-19-44` An autonomous material write proposal is not executed before approval.
 * `SCEN-19-34` A state change after approval yields a `conflict` from the executor.
 * `INV-026`, `INV-057`, `INV-058` and criterion 3 of gate M2.
 *
 * Criterion 3 is checked here, not in the delivery queue: exactly-once belongs to the **domain
 * effect**, and it is enforced by the monotonic status together with revalidation of the
 * preconditions, not by the outbox. Two presses produce one write.
 *
 * Everything is real except Notion and the bot's identity: the proposal, the preconditions, the
 * adapter over the binding, the write boundary `NotionWriter`, the executor, the worker and the
 * database. Notion is Tasks in memory that answer the way REST answers.
 */
const PAGE_ID = TASK_PAGE_ID;
/** Canonical: this is how the model supplies it, while the page comes from REST encoded. */
const STATUS_ID = TASK_STATUS_ID;
const DATE_ID = TASK_DATE_ID;

const DONE: CanonicalWriteRequest = { kind: 'option', option: 'Done' };

describe('proposal, approval, execution', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let actions: PendingActionRepository;
  let approvals: ApprovalsService;
  let router: IntentRouter;
  let worker: ExecutorWorker;
  let botKnown: boolean;
  const notion = new TasksInNotion();

  beforeAll(async () => {
    const identity: Pick<BotIdentity, 'require'> = {
      require: () =>
        botKnown ? Promise.resolve(INTEGRATION_BOT) : Promise.reject(new BotIdentityUnknownError()),
    };

    moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, appConfig, executorConfig, workersConfig)],
      providers: [
        PrismaService,
        ApprovalsService,
        PendingActionRepository,
        PreconditionEvaluator,
        ActionExecutor,
        ExecutorWorker,
        IntentRouter,
        // A text reply is another flow: decisions here are made only with the button.
        { provide: ChannelReply, useValue: {} },
        NOTICE_PROVIDER,
        PageReader,
        NotionWriter,
        SemanticAdapter,
        bindingProvider(),
        { provide: Client, useValue: notion },
        { provide: BotIdentity, useValue: identity },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    actions = moduleRef.get(PendingActionRepository);
    approvals = moduleRef.get(ApprovalsService);
    router = moduleRef.get(IntentRouter);
    worker = moduleRef.get(ExecutorWorker);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    notion.reset();
    botKnown = true;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /**
   * Describes the preconditions: the status is as the model saw it, and the page has not changed
   * since.
   */
  const pinned = (pageId = PAGE_ID): PreconditionRequest[] => [
    { kind: 'property_equals', pageId, propertyId: STATUS_ID, optionId: NEXT_ACTION },
    { kind: 'unchanged_since', pageId, lastEditedTime: LAST_EDITED },
  ];

  const writesStatus = (value: CanonicalWriteRequest, pageId = PAGE_ID): ActionEffectRequest => ({
    kind: 'property_write',
    pageId,
    propertyId: STATUS_ID,
    value,
  });

  /** An autonomous run: only it proposes. */
  const AUTONOMOUS: Actor = {
    kind: 'run',
    runId: 'run-1',
    mode: 'event_evaluation',
    provenance: { origin: 'evaluation_window' },
    startedAt: new Date(),
  };

  const propose = (value: CanonicalWriteRequest = DONE, pageId = PAGE_ID): Promise<PendingAction> =>
    proposeAs(approvals, AUTONOMOUS, {
      discussionId: 'discussion-1',
      effects: [writesStatus(value, pageId)],
      preconditions: pinned(pageId),
    });

  const approved = async (value: CanonicalWriteRequest = DONE): Promise<PendingAction> => {
    const proposal = await propose(value);

    await router.route({ kind: 'approve', pendingActionId: proposal.id }, FRESH_RECEIPT);

    return proposal;
  };

  const row = (): Promise<PendingAction> => prisma.pendingAction.findFirstOrThrow();

  /** The write of the `Done` status: the body that must reach Notion. */
  const WRITES_DONE: Update[] = [
    { page_id: PAGE_ID, properties: { [TASK_STATUS_SPELLED]: { status: { id: 'opt_done' } } } },
  ];

  describe('proposal', () => {
    it('exists from the time it is made and executes nothing', async () => {
      const proposal = await propose();

      expect(proposal.status).toBe('proposed');
      await expect(worker.runOnce()).resolves.toBe(0);
      expect(notion.updates).toEqual([]);
    });

    /**
     * `INV-057`: the person approves exactly what will be executed — the page, the property and
     * the canonical value.
     */
    it('the contract is the effects with values and the preconditions, locked when the proposal is made', async () => {
      const proposal = await propose();

      expect(proposal.effects).toEqual([writesStatus(DONE)]);
      expect(proposal.preconditions).toEqual(pinned());
    });

    it('there are never two open proposals about one change', async () => {
      const first = await propose();
      const second = await propose();

      expect(second.id).toBe(first.id);
      await expect(prisma.pendingAction.count()).resolves.toBe(1);
    });

    /**
     * Preconditions do not enter the fingerprint: the same change with a different check is the
     * same change.
     */
    it('the same change with a different check is the same row', async () => {
      const first = await propose();
      const second = await proposeAs(approvals, AUTONOMOUS, {
        effects: [writesStatus(DONE)],
        preconditions: pinned().slice(0, 1),
      });

      expect(second.id).toBe(first.id);
    });

    /**
     * What the neighboring sequential test does not reach: the `P2002` branch.
     *
     * `propose` looks for an open row and only then creates one. When several runs compose the
     * same proposal at once, all see nothing, all go to create, and the partial unique index
     * lets one of them create the row and rejects the rest with a conflict. The catch returns the
     * existing row instead of throwing: otherwise a run would fail where in fact all is well.
     *
     * There are twenty attempts because with fewer they get serialized on the connection pool and
     * the conflict branch never runs; every answer must be the same row.
     */
    it('concurrent proposals about one change yield one row', async () => {
      const racing = await Promise.all(Array.from({ length: 20 }, () => propose()));
      const ids = new Set(racing.map((proposal) => proposal.id));

      expect(ids.size).toBe(1);
      await expect(prisma.pendingAction.count()).resolves.toBe(1);
    });

    it('a different value is a different change and a separate row', async () => {
      await propose();
      await propose({ kind: 'option', option: 'Canceled' });

      await expect(prisma.pendingAction.count()).resolves.toBe(2);
    });

    /** A proposal that is false from birth does not reach the person. */
    it('a precondition that already does not hold is a refusal, not a row', async () => {
      notion.personSets('opt_done', 'Done');

      await expect(propose()).rejects.toThrow(InvalidRequestError);
      await expect(prisma.pendingAction.count()).resolves.toBe(0);
    });

    it('a terminal proposal does not block a new one about the same change', async () => {
      const first = await propose();

      await router.route({ kind: 'reject', pendingActionId: first.id }, FRESH_RECEIPT);

      const second = await propose();

      expect(second.id).not.toBe(first.id);
      await expect(prisma.pendingAction.count()).resolves.toBe(2);
    });
  });

  describe('after approval', () => {
    /**
     * `INV-058`: a system write through the write boundary writes exactly the value the person
     * saw.
     */
    it('the change is written as a system write and the row is concluded', async () => {
      await approved();

      await expect(worker.runOnce()).resolves.toBe(1);

      const settled = await row();

      expect(notion.updates).toEqual(WRITES_DONE);
      expect(settled.status).toBe('executed');
      expect(settled.resolvedAt).not.toBeNull();
    });

    /**
     * A planned date on `Next Action` means `Scheduled` (`INV-005`), so the date goes together
     * with the status — in one proposal and one write. Notion returns the time in its own format —
     * UTC with milliseconds; the check against what was read back compares the time, not the
     * string, so writing a date does not become a “discrepancy”.
     */
    it('the status and the date are written in one write, and the date is checked by time', async () => {
      const date: CanonicalWriteRequest = { kind: 'date', start: '2026-10-01T09:00:00+03:00' };
      const proposal = await proposeAs(approvals, AUTONOMOUS, {
        effects: [
          writesStatus({ kind: 'option', option: 'Scheduled' }),
          { kind: 'property_write', pageId: PAGE_ID, propertyId: DATE_ID, value: date },
        ],
        preconditions: [
          ...pinned().slice(0, 1),
          { kind: 'property_empty', pageId: PAGE_ID, propertyId: DATE_ID },
        ],
      });
      const expected: Update[] = [
        {
          page_id: PAGE_ID,
          properties: {
            [TASK_STATUS_SPELLED]: { status: { id: 'opt_scheduled' } },
            [DATE_ID]: { date: { start: '2026-10-01T09:00:00+03:00', end: null, time_zone: null } },
          },
        },
      ];

      await router.route({ kind: 'approve', pendingActionId: proposal.id }, FRESH_RECEIPT);
      await worker.runOnce();

      expect(notion.updates).toEqual(expected);
      await expect(row().then((settled) => settled.status)).resolves.toBe('executed');
    });

    /** A date without a consistent status does not reach the person (`INV-005`). */
    it('a date on `Next Action` without a status is refused already at the proposal', async () => {
      const date: CanonicalWriteRequest = { kind: 'date', start: '2026-10-01' };

      await expect(
        proposeAs(approvals, AUTONOMOUS, {
          effects: [{ kind: 'property_write', pageId: PAGE_ID, propertyId: DATE_ID, value: date }],
          preconditions: [{ kind: 'property_empty', pageId: PAGE_ID, propertyId: DATE_ID }],
        }),
      ).rejects.toThrow('a planned date makes the task Scheduled');
      await expect(prisma.pendingAction.count()).resolves.toBe(0);
    });

    /** `SCEN-19-34`: the state changed between the proposal and the approval. */
    it('a changed state yields a `conflict`, not a write', async () => {
      await approved();

      notion.personSets('opt_done', 'Done');

      await worker.runOnce();

      const settled = await row();

      expect(notion.updates).toEqual([]);
      expect(settled.status).toBe('conflict');
      expect(settled.lastError).toBe('property_equals broken: property holds opt_done');
    });

    it('a page in the trash yields a `conflict`', async () => {
      await approved();

      notion.task().inTrash = true;

      await worker.runOnce();

      await expect(row()).resolves.toMatchObject({
        status: 'conflict',
        lastError: 'page_exists broken: page is in the trash',
      });
      expect(notion.updates).toEqual([]);
    });

    it('a page that no longer exists yields a `conflict`', async () => {
      await approved();

      notion.tasks.clear();

      await worker.runOnce();

      await expect(row()).resolves.toMatchObject({
        status: 'conflict',
        lastError: 'page_exists broken: page no longer exists',
      });
    });

    /**
     * The page ceased to exist between the check and the write — Notion says so in answer to the
     * write itself.
     */
    it('a page that vanished at the instant of the write yields a `conflict`', async () => {
      await approved();

      notion.refusal = notionAnswer(APIErrorCode.ObjectNotFound, 404);

      await worker.runOnce();

      await expect(row().then((settled) => settled.status)).resolves.toBe('conflict');
    });

    /**
     * Criterion 3 of gate M2. The executor wrote and fell over before it could conclude the row:
     * the retry re-reads the precondition, sees what was already written as a changed state and
     * yields `conflict` — not a second write.
     */
    it('a retry after a write that was not recorded yields a `conflict`, not a second write', async () => {
      await approved();

      jest.spyOn(actions, 'settle').mockRejectedValueOnce(new Error('the process died'));

      await expect(worker.runOnce()).rejects.toThrow('the process died');
      await expect(row().then((stuck) => stuck.status)).resolves.toBe('approved');

      await worker.runOnce();

      expect(notion.updates).toEqual(WRITES_DONE);
      await expect(row().then((settled) => settled.status)).resolves.toBe('conflict');
    });

    /**
     * A filled date is changed under a precondition on the value the property reads currently.
     * Execution writes the new one, and a retry after a failure that left the result unrecorded
     * no longer sees the named value — `conflict`, not a second write, as for options.
     */
    it('a filled date is changed under a precondition on its value, and a retry after the write is a `conflict`', async () => {
      const task = notion.task();

      task.properties[DATE_ID] = dateProperty(DATE_ID, '2026-09-25');
      task.properties[TASK_STATUS_SPELLED] = optionProperty(
        TASK_STATUS_SPELLED,
        'opt_scheduled',
        'Scheduled',
      );

      const moved: CanonicalWriteRequest = { kind: 'date', start: '2026-10-01' };
      const proposal = await proposeAs(approvals, AUTONOMOUS, {
        effects: [{ kind: 'property_write', pageId: PAGE_ID, propertyId: DATE_ID, value: moved }],
        preconditions: [
          {
            kind: 'property_reads_as',
            pageId: PAGE_ID,
            propertyId: DATE_ID,
            value: { kind: 'date', start: '2026-09-25' },
          },
        ],
      });

      await router.route({ kind: 'approve', pendingActionId: proposal.id }, FRESH_RECEIPT);

      jest.spyOn(actions, 'settle').mockRejectedValueOnce(new Error('the process died'));

      await expect(worker.runOnce()).rejects.toThrow('the process died');
      await worker.runOnce();

      expect(notion.updates).toEqual([
        {
          page_id: PAGE_ID,
          properties: { [DATE_ID]: { date: { start: '2026-10-01', end: null, time_zone: null } } },
        },
      ]);
      await expect(row()).resolves.toMatchObject({
        status: 'conflict',
        lastError: expect.stringContaining('property_reads_as broken'),
      });
    });

    /** A proposal that writes the same value the precondition reads does not reach the person. */
    it('an effect that does not change the named value is refused already at the proposal', async () => {
      notion.task().properties[DATE_ID] = dateProperty(DATE_ID, '2026-09-25');
      notion.task().properties[TASK_STATUS_SPELLED] = optionProperty(
        TASK_STATUS_SPELLED,
        'opt_scheduled',
        'Scheduled',
      );

      const same: CanonicalWriteRequest = { kind: 'date', start: '2026-09-25' };

      await expect(
        proposeAs(approvals, AUTONOMOUS, {
          effects: [{ kind: 'property_write', pageId: PAGE_ID, propertyId: DATE_ID, value: same }],
          preconditions: [
            { kind: 'property_reads_as', pageId: PAGE_ID, propertyId: DATE_ID, value: same },
          ],
        }),
      ).rejects.toThrow('property_reads_as observes');
      await expect(prisma.pendingAction.count()).resolves.toBe(0);
    });

    /**
     * Criterion 3 of gate M2. A duplicate message yields a second press, not a second write: a
     * status other than `proposed` does nothing.
     */
    it('two presses yield one write', async () => {
      const proposal = await approved();

      await router.route({ kind: 'approve', pendingActionId: proposal.id }, FRESH_RECEIPT);
      await worker.runOnce();
      await worker.runOnce();

      expect(notion.updates).toEqual(WRITES_DONE);
    });

    it('a press after execution changes nothing', async () => {
      const proposal = await approved();

      await worker.runOnce();
      await router.route({ kind: 'approve', pendingActionId: proposal.id }, FRESH_RECEIPT);
      await worker.runOnce();

      expect(notion.updates).toEqual(WRITES_DONE);
      await expect(row().then((settled) => settled.status)).resolves.toBe('executed');
    });

    it('a rejection produces no execution', async () => {
      const proposal = await propose();

      await router.route({ kind: 'reject', pendingActionId: proposal.id }, FRESH_RECEIPT);
      await worker.runOnce();

      expect(notion.updates).toEqual([]);
      await expect(row().then((settled) => settled.status)).resolves.toBe('rejected');
    });

    it('an approval after a rejection does nothing', async () => {
      const proposal = await propose();

      await router.route({ kind: 'reject', pendingActionId: proposal.id }, FRESH_RECEIPT);
      await router.route({ kind: 'approve', pendingActionId: proposal.id }, FRESH_RECEIPT);
      await worker.runOnce();

      expect(notion.updates).toEqual([]);
    });
  });

  /**
   * `INV-005` splits the refusal by cause. A refusal that rests on the page's data is the page's
   * refusal: at the proposal it is a refusal with a reason, and at execution it is a state change
   * after the proposal (`conflict`, `INV-027`). A request that is unacceptable in any state
   * remains, at execution, an authoring fault (`failed`).
   *
   * The proposals here have no `unchanged_since`: that precondition does not see an edit made in
   * the same minute as the proposal (Notion truncates the time to the minute), but would see it
   * if the minute changed, and then it, not the write rule, would produce the `conflict`.
   */
  describe('write rule: page state and request', () => {
    const WAITING = 'opt_waiting_for';
    const KYIV_NOON = '2026-09-25T09:00:00.000+03:00';
    const NEXT_ACTION_WRITE: CanonicalWriteRequest = { kind: 'option', option: 'Next Action' };

    /** Sets up a `Waiting For` Task with the date as given. */
    const waiting = (date: RestProperty = dateProperty(DATE_ID, null)): void => {
      const task = notion.task();

      task.properties[TASK_STATUS_SPELLED] = optionProperty(
        TASK_STATUS_SPELLED,
        WAITING,
        'Waiting For',
      );
      task.properties[DATE_ID] = date;
    };

    const stillWaiting: PreconditionRequest = {
      kind: 'property_equals',
      pageId: PAGE_ID,
      propertyId: STATUS_ID,
      optionId: WAITING,
    };

    const clearsDate: ActionEffectRequest = {
      kind: 'property_write',
      pageId: PAGE_ID,
      propertyId: DATE_ID,
      value: { kind: 'clear' },
    };

    const approve = (id: string): Promise<unknown> =>
      router.route({ kind: 'approve', pendingActionId: id }, FRESH_RECEIPT);

    it('a date that appeared after the proposal yields a `conflict`, not `failed`', async () => {
      waiting();

      const proposal = await proposeAs(approvals, AUTONOMOUS, {
        effects: [writesStatus(NEXT_ACTION_WRITE)],
        preconditions: [stillWaiting],
      });

      await approve(proposal.id);

      // The person gave the Task a date; the time of the edit stayed the same.
      notion.task().properties[DATE_ID] = dateProperty(DATE_ID, '2026-09-25');

      await worker.runOnce();

      expect(notion.updates).toEqual([]);
      await expect(row()).resolves.toMatchObject({
        status: 'conflict',
        lastError: expect.stringContaining('the page changed after the proposal'),
      });
    });

    it('a move of a Task with a date into `Next Action` does not reach the person', async () => {
      waiting(dateProperty(DATE_ID, '2026-09-25'));

      await expect(
        proposeAs(approvals, AUTONOMOUS, {
          effects: [writesStatus(NEXT_ACTION_WRITE)],
          preconditions: [stillWaiting],
        }),
      ).rejects.toThrow('clear the date in the same change');
      await expect(prisma.pendingAction.count()).resolves.toBe(0);
    });

    /**
     * A date to which the person gave a time zone in Notion is cleared by the same proposal as an
     * ordinary one: the precondition on its value compares the time, and the time zone is an
     * annotation of the time.
     */
    it.each([
      ['without a time zone', null],
      ['with a time zone', 'Europe/Kyiv'],
    ])('the status and clearing of a date %s: one proposal and one write', async (_, timeZone) => {
      waiting(dateProperty(DATE_ID, KYIV_NOON, timeZone));

      const proposal = await proposeAs(approvals, AUTONOMOUS, {
        effects: [writesStatus(NEXT_ACTION_WRITE), clearsDate],
        preconditions: [
          stillWaiting,
          {
            kind: 'property_reads_as',
            pageId: PAGE_ID,
            propertyId: DATE_ID,
            value: { kind: 'date', start: '2026-09-25T06:00:00.000Z' },
          },
        ],
      });

      await approve(proposal.id);
      await worker.runOnce();

      expect(notion.updates).toEqual([
        {
          page_id: PAGE_ID,
          properties: {
            [TASK_STATUS_SPELLED]: { status: { id: NEXT_ACTION } },
            [DATE_ID]: { date: null },
          },
        },
      ]);
      await expect(row()).resolves.toMatchObject({ status: 'executed' });
    });

    /**
     * A row that `check` would not let through (written by another version) is a fault of the
     * request, not of the state.
     */
    it('a request that is unacceptable in any state stays `failed`', async () => {
      const proposal = await approved();

      await prisma.pendingAction.update({
        where: { id: proposal.id },
        data: {
          effects: [
            writesStatus(NEXT_ACTION_WRITE),
            {
              kind: 'property_write',
              pageId: PAGE_ID,
              propertyId: DATE_ID,
              value: { kind: 'date', start: '2026-10-01', end: null },
            },
          ],
          preconditions: [
            {
              kind: 'property_equals',
              pageId: PAGE_ID,
              propertyId: STATUS_ID,
              optionId: NEXT_ACTION,
            },
            { kind: 'property_empty', pageId: PAGE_ID, propertyId: DATE_ID },
          ],
        },
      });
      await worker.runOnce();

      expect(notion.updates).toEqual([]);
      await expect(row()).resolves.toMatchObject({
        status: 'failed',
        lastError: expect.stringContaining('choose Scheduled or drop the date'),
      });
    });
  });

  /**
   * Notion being unreachable and a write failure are different things
   * (`docs/2-system.md` § “Preconditions and executor”).
   */
  describe('the Notion answer to a write', () => {
    /**
     * `failed` needs attention, and attention without a diagnosis has nothing to look at: the
     * reason is recorded on the row, not only in the log.
     */
    it('an invalid write yields `failed` with a reason, not a new proposal', async () => {
      const proposal = await approved();

      notion.refusal = notionAnswer(APIErrorCode.ValidationError, 400);

      await worker.runOnce();

      const settled: Pick<PendingAction, 'status' | 'lastError' | 'failure'> = {
        status: 'failed',
        lastError: 'Notion refused the write: Notion answered validation_error',
        failure: 'other',
      };

      await expect(row()).resolves.toMatchObject(settled);

      // A failure cannot be recorded without a reason: the type does not allow it
      // (`npm run typecheck`). And a row that has already reached a conclusion is not touched by
      // a repeated conclusion — the reason stays.
      const unexplained = (): Promise<void> =>
        // @ts-expect-error — a terminal failure is not written without a reason.
        actions.settle(proposal.id, 'failed');

      await unexplained();
      await expect(row()).resolves.toMatchObject(settled);
    });

    /**
     * The rate limit changed nothing, so the approval stands: `failed` here would mean
     * that the person has to decide anew what was already decided.
     */
    it('a Notion rate limit keeps the approval in force and postpones the attempt', async () => {
      await approved();

      notion.refusal = notionAnswer(APIErrorCode.RateLimited, 429);

      await worker.runOnce();

      await expect(row()).resolves.toMatchObject({ status: 'approved', resolvedAt: null });

      // A postponed action is skipped by the next tick — otherwise it would be queried again
      // every fifteen seconds forever.
      await expect(worker.runOnce()).resolves.toBe(0);
      expect(notion.updates).toHaveLength(1);

      notion.refusal = null;

      // The time the attempt comes due is in the row, not in process memory: that is why the
      // postponement survives a restart.
      await prisma.pendingAction.updateMany({
        data: { nextAttemptAt: subMilliseconds(new Date(), 1) },
      });
      await worker.runOnce();

      expect(notion.updates).toHaveLength(2);
      await expect(row().then((settled) => settled.status)).resolves.toBe('executed');
    });

    /**
     * The same when Notion did not answer the **read** of the preconditions: nothing has changed,
     * so the approval stands and is postponed. An error thrown from here would stop the
     * tick at the very first action — and everything approved after it would sit there, polled
     * every fifteen seconds with no time set for the next attempt.
     */
    it('a Notion rate limit on reading preconditions postpones the action instead of failing the tick', async () => {
      await approved();

      notion.readRefusal = notionAnswer(APIErrorCode.RateLimited, 429);

      await expect(worker.runOnce()).resolves.toBe(1);

      await expect(row()).resolves.toMatchObject({
        status: 'approved',
        resolvedAt: null,
        nextAttemptAt: expect.any(Date),
      });
      expect(notion.updates).toEqual([]);

      // A postponed action is skipped by the next tick: the row is not polled again until its time.
      await expect(worker.runOnce()).resolves.toBe(0);

      notion.readRefusal = null;

      await prisma.pendingAction.updateMany({
        data: { nextAttemptAt: subMilliseconds(new Date(), 1) },
      });
      await worker.runOnce();

      expect(notion.updates).toEqual(WRITES_DONE);
      await expect(row().then((settled) => settled.status)).resolves.toBe('executed');
    });

    /**
     * This is what would starve the queue. Postponed actions are skipped by the selection, not
     * inside the batch: otherwise `batchSize` postponed ones would make every following approved
     * action invisible — the person would press “Approve”, and nothing would happen, with no
     * error at all.
     */
    it('postponed actions do not hide the following ones behind them', async () => {
      // The number comes from the same configuration as the worker's, because a second literal
      // would drift away from it silently.
      const batch = executorConfig().batchSize;
      const pageOf = (index: number): string =>
        `1f2e3d4c-5b6a-4978-8a9b-${String(index).padStart(12, '0')}`;
      const stuck: string[] = [];

      notion.refusal = notionAnswer(APIErrorCode.ServiceUnavailable, 503);

      for (let index = 0; index < batch; index += 1) {
        notion.add(pageOf(index));

        const blocked = await propose(DONE, pageOf(index));

        await router.route({ kind: 'approve', pendingActionId: blocked.id }, FRESH_RECEIPT);
        stuck.push(blocked.id);
      }

      await worker.runOnce();
      expect(notion.updates).toHaveLength(batch);

      notion.refusal = null;

      const fresh = await approved();

      await worker.runOnce();

      await expect(
        prisma.pendingAction.findUniqueOrThrow({ where: { id: fresh.id } }).then((r) => r.status),
      ).resolves.toBe('executed');
      await expect(
        prisma.pendingAction.count({ where: { id: { in: stuck }, status: 'approved' } }),
      ).resolves.toBe(batch);
    });

    /**
     * The write took place, but in someone else's name: the system's own writes are recognized by
     * the author, so this is not a success. Nor is it a retry: a retry would see its own effect
     * as a changed state.
     */
    it('a write that Notion attributed to someone other than the bot yields `failed`', async () => {
      await approved();

      notion.author = A_PERSON;

      await worker.runOnce();
      await worker.runOnce();

      const settled = await row();

      expect(notion.updates).toEqual(WRITES_DONE);
      expect(settled.status).toBe('failed');
      expect(settled.lastError).toContain(`attributed it to ${A_PERSON}`);
    });

    it('Notion returning what was not written yields `failed` with a named discrepancy', async () => {
      await approved();

      notion.echo = (id) => optionProperty(id, 'opt_canceled', 'Canceled');

      await worker.runOnce();

      await expect(row()).resolves.toMatchObject({
        status: 'failed',
        lastError: `Notion reads back what was not written: ${STATUS_ID} is not option`,
      });
    });

    /** Allows the next attempt of the postponed action to be made right away. */
    const due = (): Promise<unknown> =>
      prisma.pendingAction.updateMany({ data: { nextAttemptAt: subMilliseconds(new Date(), 1) } });

    /** The unavailability limit is measured from the approval: the row remembers its time. */
    it('an approval records its time', async () => {
      await approved();

      await expect(row().then((settled) => settled.approvedAt)).resolves.toEqual(expect.any(Date));
    });

    /**
     * An access refusal does not clear on its own (ADR 0044): after the attempt limit, the
     * approved action becomes unexecuted with the kind “no access”, instead of being retried
     * endlessly and without a trace.
     */
    it.each([
      ['on write', 'write', notionAnswer(APIErrorCode.RestrictedResource, 403)],
      ['on reading preconditions', 'read', notionAnswer(APIErrorCode.Unauthorized, 401)],
    ] as const)(
      'an access refusal %s: the attempt limit, then “no access”',
      async (_where, at, refusal) => {
        await approved();

        if (at === 'write') notion.refusal = refusal;
        else notion.readRefusal = refusal;

        const limit = executorConfig().noAccessMaxAttempts;

        for (let attempt = 1; attempt < limit; attempt += 1) {
          await worker.runOnce();
          await expect(row()).resolves.toMatchObject({
            status: 'approved',
            accessFailures: attempt,
            resolvedAt: null,
          });
          await due();
        }

        await worker.runOnce();

        await expect(row()).resolves.toMatchObject({ status: 'failed', failure: 'no_access' });
      },
    );

    /**
     * Temporary unavailability clears on its own, so the action waits — but not longer than the
     * limit from the approval (ADR 0044): after that the person must learn that what was approved
     * has not been written.
     */
    it('temporary unavailability: a retry up to the limit from the approval, then “Notion did not respond”', async () => {
      await approved();

      notion.refusal = notionAnswer(APIErrorCode.ServiceUnavailable, 503);

      await worker.runOnce();
      await expect(row()).resolves.toMatchObject({ status: 'approved', accessFailures: 0 });

      await prisma.pendingAction.updateMany({
        data: {
          approvedAt: subHours(new Date(), executorConfig().unavailableMaxHours),
          nextAttemptAt: subMilliseconds(new Date(), 1),
        },
      });
      await worker.runOnce();

      await expect(row()).resolves.toMatchObject({ status: 'failed', failure: 'unavailable' });
    });

    /**
     * While it is unknown who we are, the author of the answer has nothing to be checked against
     * — and nothing is written.
     */
    it('while the bot is unknown there is no write and the approval waits', async () => {
      await approved();

      botKnown = false;

      await worker.runOnce();

      expect(notion.updates).toEqual([]);
      await expect(row()).resolves.toMatchObject({ status: 'approved', resolvedAt: null });
    });
  });

  /**
   * A row whose preconditions or effect cannot be recognized can never be executed: it was
   * either written by another version or is corrupted. `failed` is more honest than retries
   * here, because it needs attention, not waiting.
   */
  describe('unrecognized row', () => {
    const corrupt = async (data: Record<string, unknown>): Promise<PendingAction> => {
      const proposal = await approved();

      await prisma.pendingAction.update({ where: { id: proposal.id }, data });
      await worker.runOnce();

      return row();
    };

    it('corrupted preconditions yield `failed` with no write', async () => {
      const settled = await corrupt({ preconditions: [{ kind: 'nonsense' }] });

      expect(notion.updates).toEqual([]);
      expect(settled).toMatchObject({
        status: 'failed',
        lastError: 'preconditions are unrecognisable',
      });
    });

    /** An effect without a value cannot be executed the way it was shown to the person. */
    it('an effect without a value yields `failed` with no write', async () => {
      const settled = await corrupt({
        effects: [{ kind: 'property_write', pageId: PAGE_ID, propertyId: STATUS_ID }],
      });

      expect(notion.updates).toEqual([]);
      expect(settled).toMatchObject({ status: 'failed', lastError: 'effects are unrecognisable' });
    });

    /**
     * Creating a page is not a declarable effect (`GAP-24`): nothing enforces its once-only
     * execution, and a retry after a failure would make a second page.
     */
    it('an effect that is not in the vocabulary is not executed', async () => {
      const settled = await corrupt({ effects: [{ kind: 'page_create', dataSourceId: 'ds-1' }] });

      expect(notion.updates).toEqual([]);
      expect(settled).toMatchObject({ status: 'failed', lastError: 'effects are unrecognisable' });
    });

    it('effects on two different objects yield `failed`', async () => {
      const settled = await corrupt({
        effects: [writesStatus(DONE), writesStatus(DONE, '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d')],
      });

      expect(notion.updates).toEqual([]);
      expect(settled.status).toBe('failed');
      expect(settled.lastError).toContain('touches more than one object');
    });

    it('two writes of one property yield `failed`', async () => {
      const settled = await corrupt({
        effects: [writesStatus(DONE), writesStatus({ kind: 'option', option: 'Canceled' })],
      });

      expect(notion.updates).toEqual([]);
      expect(settled.lastError).toContain('writes the same property more than once');
    });
  });

  /**
   * A proposal the person got ahead of is closed by the system (ADR 0044): the same mechanical
   * check of the preconditions as after a press, but without a press and without a write.
   */
  describe('a proposal the person got ahead of', () => {
    it('the person changed the status themselves: the proposal is closed as `conflict`, nothing is written to Notion', async () => {
      await propose();

      notion.personSets('opt_done', 'Done');
      await approvals.recheckOn(PAGE_ID);
      await worker.runOnce();

      const closed = await row();

      expect(closed.status).toBe('conflict');
      expect(closed.lastError).toContain('property_equals broken');
      expect(closed.recheckRequestedAt).toBeNull();
      expect(notion.updates).toEqual([]);
    });

    it('a change that does not break the preconditions leaves the proposal awaiting a decision', async () => {
      await propose();

      notion.task().properties.title = textProperty('title', 'Подзвонити в банк до обіду');
      await approvals.recheckOn(PAGE_ID);
      await worker.runOnce();

      await expect(row()).resolves.toMatchObject({ status: 'proposed', recheckRequestedAt: null });
    });

    it('without a request the executor does not read a proposal that awaits a decision', async () => {
      await propose();

      notion.personSets('opt_done', 'Done');
      await worker.runOnce();

      await expect(row().then((open) => open.status)).resolves.toBe('proposed');
    });
  });

  /**
   * Only what a delivered Daily Control packet showed expires (ADR 0039): the App states the
   * shown ids, and of those expiry affects only what still awaits the person's decision.
   */
  describe('expiry of what was shown', () => {
    /** The fate publication will tell the message that the proposal has expired (`INV-107`). */
    it('a shown proposal that still awaits a decision expires and waits for publication', async () => {
      const { id } = await propose();

      await expect(approvals.lapseShown([id])).resolves.toBe(1);
      await expect(row()).resolves.toMatchObject({ status: 'expired', publishedStatus: null });
    });

    it('expiry does not touch what was approved', async () => {
      const { id } = await approved();

      await expect(approvals.lapseShown([id])).resolves.toBe(0);
      await expect(row().then((open) => open.status)).resolves.toBe('approved');
    });

    it('what was not shown does not expire', async () => {
      await propose();

      await expect(approvals.lapseShown([])).resolves.toBe(0);
      await expect(row().then((open) => open.status)).resolves.toBe('proposed');
    });

    it('the button of an expired proposal says that it has expired', async () => {
      const { id } = await propose();

      await approvals.lapseShown([id]);

      await expect(
        router.route({ kind: 'approve', pendingActionId: id }, FRESH_RECEIPT),
      ).resolves.toEqual({ kind: 'expired' });
    });
  });
});
