import { randomUUID } from 'node:crypto';
import { addHours, addMinutes } from 'date-fns';
import { z } from 'zod';
import { ContinuationRequest } from '../../src/continuations/continuation.schema';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { runDeliveryKey } from '../../src/delivery/delivery-key';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { RunSessions } from '../../src/mcp/server/run-sessions';
import { Page } from '../../src/notion/client/page';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { CHAT } from '../../src/runs/actor';
import { EffectsGrant, EffectsReport } from '../../src/runs/run-effects';
import { serverTools } from '../../src/runs/toolsets';
import { pageIn } from '../fixtures/capture-world';
import { TASK_STATUS_ID, VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { taskWithStatus } from '../fixtures/notion-page.fixture';
import {
  AppMcpHarness,
  buildAppMcpHarness,
  call,
  callMalformed,
  Connected,
  grant,
  jsonOf,
  textOf,
  ToolArguments,
} from './app-mcp.harness';
import { truncateAll } from './database';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const LATER = '2026-12-01T09:00:00+02:00';

/** A snooze the person sets on a thread themselves: an autonomous run does not move it. */
const PERSONS_SNOOZE: ContinuationRequest = {
  discussionId: THREAD,
  notionPageId: PAGE,
  runAt: new Date('2026-11-01T09:00:00.000Z'),
  reasonCode: 'user_snooze',
};

/** An item the person put in the Inbox. */
const INBOX_ITEM = '6e7f8a9b-0c1d-4e2f-9a3b-4c5d6e7f8a9b';
const AN_INBOX_ITEM: Page = pageIn(
  'inbox_item',
  INBOX_ITEM,
  VALID_BINDING_FILE.data_sources.inbox_item,
);

/** A Task in Notion that the proposal concerns: status `Next Action`. */
const A_TASK: Page = { ...taskWithStatus('opt_next_action', 'Next Action'), id: PAGE };

const A_PROPOSAL: ToolArguments['create_pending_action'] = {
  effects: [
    {
      kind: 'property_write',
      page_id: PAGE,
      property_id: TASK_STATUS_ID,
      value: { kind: 'option', option: 'Done' },
    },
  ],
  preconditions: [
    {
      kind: 'property_equals',
      page_id: PAGE,
      property_id: TASK_STATUS_ID,
      option_id: 'opt_next_action',
    },
  ],
};

function aNotification(pendingActionId?: string): ToolArguments['queue_notification'] {
  return {
    channel: 'telegram',
    message: {
      noticed: 'Задача чекає на відповідь постачальника',
      why_it_matters: 'Вона блокує єдиний критичний шлях проєкту',
      ask: 'Позначити як виконану?',
      link: 'https://www.notion.so/page-1',
      ...(pendingActionId
        ? {
            proposals: [{ pending_action_id: pendingActionId, line: 'Позначити задачу виконаною' }],
          }
        : {}),
    },
  };
}

/**
 * The App MCP over real capabilities and a real database, without HTTP, through an in-memory
 * transport and the SDK's real MCP client. The HTTP boundary (bearer, 401, 405) is checked by e2e.
 * This suite checks what the tools do with the run's writes (ADR 0014).
 */
describe('App MCP: run writes', () => {
  let harness: AppMcpHarness;
  let moduleRef: AppMcpHarness['moduleRef'];
  let prisma: PrismaService;
  let sessions: RunSessions;

  beforeAll(async () => {
    harness = await buildAppMcpHarness(A_TASK, new Map([[INBOX_ITEM, AN_INBOX_ITEM]]));
    moduleRef = harness.moduleRef;
    prisma = harness.prisma;
    sessions = harness.sessions;
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    harness.notion.reset();
  });

  afterEach(async () => {
    await harness.disconnect();
  });

  afterAll(async () => {
    await harness.close();
  });

  const connected = (given?: EffectsGrant): Promise<Connected> => harness.connected(given);

  const rows = async (): Promise<[number, number, number]> => [
    await prisma.scheduledCheck.count(),
    await prisma.pendingAction.count(),
    await prisma.notificationOutbox.count(),
  ];

  describe('surface', () => {
    it.each(Object.values(WorkflowMode))(
      'tools/list of a %s session is the App part of the row',
      async (mode) => {
        const { client } = await connected(grant(mode));
        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name).sort()).toEqual(serverTools(mode, 'app').sort());
      },
    );

    it('deciding on a run proposal is not shown in any mode', () => {
      for (const mode of Object.values(WorkflowMode)) {
        expect(serverTools(mode, 'app')).not.toContain('decide_pending_action');
      }
    });
  });

  /**
   * The model takes the grammatical gender for addressing the owner, and the gender the assistant
   * uses for itself, from `runtime_read`. It does not guess them from the name (ADR 0046). With no
   * setting, sentences contain no gender forms. The assistant name also comes from `runtime_read`
   * (ADR 0049), and with no setting the assistant has no name.
   */
  it('the runtime state names the grammatical gender of address, and the assistant name and gender, from the installation setting', async () => {
    const { client } = await connected();

    expect(jsonOf(await call(client, 'get_runtime_state', {}))).toMatchObject({
      person_gender: 'neutral',
      assistant_name: null,
      assistant_gender: 'neutral',
    });
  });

  describe('staging', () => {
    it('run writes do not appear before the conclusion', async () => {
      const given = grant();
      const { client } = await connected(given);

      const scheduled = await call(client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'await_external_event',
      });
      const queued = await call(client, 'queue_notification', aNotification());

      expect(scheduled.isError).toBeFalsy();
      expect(jsonOf(scheduled)).toMatchObject({ staged: true });
      expect(jsonOf(queued)).toMatchObject({
        staged: true,
        idempotency_key: runDeliveryKey(given.cause),
      });
      await expect(rows()).resolves.toEqual([0, 0, 0]);
    });

    /**
     * The order is fixed: delivery never announces an effect that has not been applied yet, so the
     * button also gets the real proposal id.
     */
    it('a valid conclusion applies continuations → proposals → deliveries', async () => {
      const given = grant();
      const { session, client } = await connected(given);
      const proposed = jsonOf(await call(client, 'create_pending_action', A_PROPOSAL));
      const provisional = z.string().parse(proposed.pending_action_id);

      await call(client, 'queue_notification', aNotification(provisional));
      await call(client, 'schedule_continuation', {
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'safety_recheck',
      });

      const report = await session.commit();
      const proposal = await prisma.pendingAction.findFirstOrThrow();
      const delivery = await prisma.notificationOutbox.findFirstOrThrow();

      expect(report.failure).toBeUndefined();
      expect(report.applied.map((effect) => effect.kind)).toEqual([
        'continuation',
        'proposal',
        'delivery',
      ]);
      expect(proposal.proposedByRunId).toBe(given.runId);
      expect(JSON.stringify(delivery.payload)).toContain(proposal.id);
      expect(JSON.stringify(delivery.payload)).not.toContain(provisional);
    });

    /**
     * A proposal that cannot be executed does not reach the person: the refusal comes on the call,
     * with a reason, and nothing else is refused. The rest of the run's writes are applied.
     */
    it('a proposal whose precondition no longer holds is refused on the call', async () => {
      const { session, client } = await connected();
      const stale: ToolArguments['create_pending_action'] = {
        ...A_PROPOSAL,
        preconditions: [
          {
            kind: 'property_equals',
            page_id: PAGE,
            property_id: TASK_STATUS_ID,
            option_id: 'opt_waiting_for',
          },
        ],
      };

      const refused = await call(client, 'create_pending_action', stale);

      await call(client, 'queue_notification', aNotification());

      const report = await session.commit();

      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toBe(
        'proposal: precondition property_equals broken — property holds opt_next_action',
      );
      expect(report.refused).toEqual([{ tool: 'create_pending_action', reason: textOf(refused) }]);
      await expect(rows()).resolves.toEqual([0, 0, 1]);
    });

    it('a failed or deferred run leaves nothing', async () => {
      const { session, client } = await connected();

      await call(client, 'queue_notification', aNotification());
      await call(client, 'create_pending_action', A_PROPOSAL);

      const report = await session.discard();

      expect(report.applied).toEqual([]);
      await expect(rows()).resolves.toEqual([0, 0, 0]);
    });

    /**
     * The session closes before it starts applying, because a write that arrived in the middle of
     * applying would land outside the decision about the conclusion.
     */
    it('while the writes are being applied, the session no longer accepts calls', async () => {
      const { session, client } = await connected();
      const continuations = moduleRef.get(ContinuationsService);
      const schedule: ContinuationsService['schedule'] = continuations.schedule.bind(continuations);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      await call(client, 'schedule_continuation', {
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'safety_recheck',
      });

      jest.spyOn(continuations, 'schedule').mockImplementationOnce(async (actor, request) => {
        await held;

        return schedule(actor, request);
      });

      const committing = session.commit();

      expect(sessions.resolve(session.bearer)).toBeNull();

      const late = await call(client, 'queue_notification', aNotification());

      release();

      const report = await committing;

      expect(late.isError).toBe(true);
      expect(report.applied.map((effect) => effect.kind)).toEqual(['continuation']);
      await expect(prisma.notificationOutbox.count()).resolves.toBe(0);
    });

    it('a session that has ended no longer accepts writes', async () => {
      const { session } = await connected();

      await session.commit();

      expect(sessions.resolve(session.bearer)).toBeNull();
    });

    /**
     * One run, one delivery: the key is derived from the cause, so a second delivery would be the
     * same one.
     */
    it('a second delivery from the same run is rejected on the call', async () => {
      const { client, session } = await connected();

      await call(client, 'queue_notification', aNotification());
      const second = await call(client, 'queue_notification', aNotification());

      expect(second.isError).toBe(true);
      expect(textOf(second)).toContain('at most one');

      const report = await session.commit();

      expect(report.applied.filter((effect) => effect.kind === 'delivery')).toHaveLength(1);
    });

    /**
     * A second delivery with the same key queues nothing, and the model already knows this at call
     * time.
     */
    it('a repeat of the same delivery makes no duplicate', async () => {
      const given = grant();
      const first = await connected(given);

      await call(first.client, 'queue_notification', aNotification());
      await first.session.commit();

      // A repeat of the same cause after a failure: another run, the same `event_id`.
      const second = await connected({ ...grant(), cause: given.cause });
      const again = jsonOf(await call(second.client, 'queue_notification', aNotification()));

      await second.session.commit();

      expect(again).toMatchObject({ already_queued: { status: 'pending' } });
      await expect(prisma.notificationOutbox.count()).resolves.toBe(1);
    });
  });

  describe('a read sees what this run has written', () => {
    it('the continuation, the delivery and the proposal, with status `staged`', async () => {
      const given = grant();
      const { client } = await connected(given);

      await call(client, 'schedule_continuation', {
        discussion_id: THREAD.replaceAll('-', '').toUpperCase(),
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'await_external_event',
      });
      await call(client, 'queue_notification', aNotification());

      const proposed = jsonOf(await call(client, 'create_pending_action', A_PROPOSAL));
      const continuations = jsonOf(
        await call(client, 'get_continuation_state', { discussion_id: THREAD }),
      );
      // Without a key, the run asks about the delivery of its own cause.
      const delivery = jsonOf(await call(client, 'get_delivery_state', {}));
      const proposal = jsonOf(
        await call(client, 'get_pending_action', {
          pending_action_id: z.string().parse(proposed.pending_action_id),
        }),
      );

      expect(continuations).toEqual({
        continuations: [
          {
            discussion_id: THREAD,
            page_id: PAGE,
            reason_code: 'await_external_event',
            run_at: new Date(LATER).toISOString(),
            status: 'staged',
          },
        ],
      });
      expect(delivery).toEqual({ idempotency_key: runDeliveryKey(given.cause), status: 'staged' });
      expect(proposal).toMatchObject({
        status: 'staged',
        effects: [{ property_id: TASK_STATUS_ID, value: { kind: 'option', option: 'Done' } }],
      });
    });

    /**
     * A page has continuations of its own and of its threads: a run that moved a thread and then
     * asks about the page sees the thread already moved, not the old time next to the new one.
     */
    it('a moved thread shows in the page state too', async () => {
      const first = await connected();

      await call(first.client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'await_external_event',
      });
      await first.session.commit();

      const { client } = await connected();
      const moved = '2026-12-02T09:00:00+02:00';

      await call(client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: moved,
        reason_code: 'safety_recheck',
      });

      const byPage = jsonOf(await call(client, 'get_continuation_state', { page_id: PAGE }));
      const byOldReason = jsonOf(
        await call(client, 'get_continuation_state', {
          page_id: PAGE,
          reason_code: 'await_external_event',
        }),
      );

      expect(byPage).toEqual({
        continuations: [
          {
            discussion_id: THREAD,
            page_id: PAGE,
            reason_code: 'safety_recheck',
            run_at: new Date(moved).toISOString(),
            status: 'staged',
          },
        ],
      });
      expect(byOldReason).toEqual({ continuations: [] });
    });

    /** `INV-030`: a read shows the status and the domain times but no queue bookkeeping. */
    it('what was applied reads without queue bookkeeping', async () => {
      const first = await connected();

      await call(first.client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'await_external_event',
      });
      await first.session.commit();

      const { client } = await connected();
      const state = z
        .object({ continuations: z.array(z.record(z.string(), z.unknown())) })
        .parse(jsonOf(await call(client, 'get_continuation_state', { discussion_id: THREAD })));
      const [row] = state.continuations;

      expect(Object.keys(row).sort()).toEqual(
        ['discussion_id', 'page_id', 'reason_code', 'run_at', 'status'].sort(),
      );
    });
  });

  describe('refusal and failure', () => {
    /**
     * The model can correct a refusal, and it is recorded in the run trace next to the perimeter
     * refusals.
     */
    it('a capability refusal is text for the model and an entry among the session refusals', async () => {
      const { session, client } = await connected();
      const refused = await call(client, 'schedule_continuation', {
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'user_snooze',
      });

      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('user_snooze');

      const report: EffectsReport = await session.commit();

      expect(report.failure).toBeUndefined();
      expect(report.refused).toEqual([
        { tool: 'schedule_continuation', reason: expect.stringContaining('user_snooze') },
      ]);
    });

    /**
     * A question about state names a thread or a page, exactly one. The wire translation says so,
     * and what it says stays a refusal. The refusal is text for the model and an entry among the
     * session refusals, and the session is not poisoned.
     */
    it('continuation state with neither a thread nor a page, or with both, is refused', async () => {
      const { session, client } = await connected();
      const neither = await call(client, 'get_continuation_state', {});
      const both = await call(client, 'get_continuation_state', {
        discussion_id: THREAD,
        page_id: PAGE,
      });

      const report: EffectsReport = await session.commit();
      const reason = 'continuation state: name either a discussion_id or a page_id';
      const errors: boolean[] = [true, true];
      const texts: string[] = [reason, reason];
      const refused: EffectsReport['refused'] = [
        { tool: 'get_continuation_state', reason },
        { tool: 'get_continuation_state', reason },
      ];

      expect([neither.isError, both.isError]).toEqual(errors);
      expect([textOf(neither), textOf(both)]).toEqual(texts);
      expect(report.failure).toBeUndefined();
      expect(report.refused).toEqual(refused);
    });

    /**
     * The start time reaches the service with the run's grant: a run without the person that wants
     * to wake in ten minutes gets a refusal with the earliest allowed time, and can correct the
     * request.
     */
    it('a run without the person does not wake a thread sooner than an hour after its own start', async () => {
      const startedAt = new Date();
      const { session, client } = await connected({ ...grant(), startedAt });
      const soon = addMinutes(startedAt, 10).toISOString();
      const earliest = addHours(startedAt, 1).toISOString();

      const refused = await call(client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: soon,
        reason_code: 'await_external_event',
      });
      const accepted = await call(client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: earliest,
        reason_code: 'await_external_event',
      });

      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain(earliest);
      expect(accepted.isError).toBeFalsy();

      const report: EffectsReport = await session.commit();

      expect(report.failure).toBeUndefined();
      expect(report.applied.map((effect) => effect.kind)).toEqual(['continuation']);
    });

    it('a button for a proposal that does not exist is refused on the call itself', async () => {
      const { client } = await connected();
      const refused = await call(client, 'queue_notification', aNotification(randomUUID()));

      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("does not await the person's decision");
    });

    /**
     * The model sees only that the run's writes cannot be relied on, and the session is poisoned:
     * writes composed without knowing what happened to this call are not applied.
     */
    it('a failure poisons the session, and its writes are not applied', async () => {
      const { session, client } = await connected();

      await call(client, 'queue_notification', aNotification());

      jest
        .spyOn(moduleRef.get(ContinuationsService), 'check')
        .mockRejectedValueOnce(new Error('connection terminated'));

      const failed = await call(client, 'schedule_continuation', {
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'safety_recheck',
      });
      const report = await session.commit();

      expect(failed.isError).toBe(true);
      expect(textOf(failed)).not.toContain('connection terminated');
      expect(report.failure).toContain('poisoned');
      expect(report.failure).toContain('connection terminated');
      await expect(rows()).resolves.toEqual([0, 0, 0]);
    });

    /**
     * The state may have changed while the run was thinking: the person set a snooze on the
     * thread. The recheck sees the snooze before the first write, and nothing is applied, even what
     * does not depend on the snooze.
     */
    it('the recheck stops applying before the first write', async () => {
      const { session, client } = await connected();

      await call(client, 'schedule_continuation', {
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'safety_recheck',
      });
      await call(client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'await_external_event',
      });
      await call(client, 'queue_notification', aNotification());
      await moduleRef.get(ContinuationsService).schedule(CHAT, PERSONS_SNOOZE);

      const report = await session.commit();

      expect(report.applied).toEqual([]);
      expect(report.failure).toContain("the person's own snooze");
      await expect(rows()).resolves.toEqual([1, 0, 0]);
    });

    /**
     * Applying is not atomic: the person could set a snooze even after the recheck. Then the rest
     * stops, and what was applied before the refusal stays and is recorded in the run trace.
     */
    it('a refusal between the check and the write stops the rest and leaves the applied prefix', async () => {
      const { session, client } = await connected();
      const continuations = moduleRef.get(ContinuationsService);
      const schedule: ContinuationsService['schedule'] = continuations.schedule.bind(continuations);

      await call(client, 'schedule_continuation', {
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'safety_recheck',
      });
      await call(client, 'schedule_continuation', {
        discussion_id: THREAD,
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'await_external_event',
      });
      await call(client, 'queue_notification', aNotification());

      jest
        .spyOn(continuations, 'schedule')
        .mockImplementationOnce(schedule)
        .mockImplementationOnce(async (actor, request) => {
          await schedule(CHAT, PERSONS_SNOOZE);

          return schedule(actor, request);
        });

      const report = await session.commit();

      expect(report.applied.map((effect) => effect.kind)).toEqual(['continuation']);
      expect(report.failure).toContain("the person's own snooze");
      await expect(rows()).resolves.toEqual([2, 0, 0]);
    });
  });

  /**
   * A person's snooze that has not fired yet keeps its page and thread out of the review. A review
   * has no new event, so until the time the person named it says nothing about them: no comment,
   * no proposal, no message. The run for an event judges the new event itself.
   */
  describe("a person's snooze", () => {
    const REVIEWING = (): EffectsGrant =>
      grant('weekly_control_review', { origin: 'review_schedule' });
    const OTHER_PAGE = '5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a';

    beforeEach(async () => {
      await moduleRef.get(ContinuationsService).schedule(CHAT, PERSONS_SNOOZE);
    });

    it('a review does not comment on the page, propose anything about it or notify about the thread', async () => {
      const { session, client } = await connected(REVIEWING());
      const answers = [
        await call(client, 'add_comment', { page_id: PAGE, text: 'Задача стоїть тиждень' }),
        await call(client, 'create_pending_action', A_PROPOSAL),
        await call(client, 'queue_notification', { ...aNotification(), discussion_id: THREAD }),
      ];

      for (const answer of answers) {
        expect(answer.isError).toBe(true);
        expect(textOf(answer)).toContain(
          `the person snoozed this until ${PERSONS_SNOOZE.runAt.toISOString()}`,
        );
      }

      const report = await session.commit();

      expect(report.applied).toEqual([]);
      expect(report.refused.map((refusal) => refusal.tool)).toEqual([
        'add_comment',
        'create_pending_action',
        'queue_notification',
      ]);
    });

    /**
     * The model takes the thread from the Notion MCP as an address; the App takes the id from it
     * and recognizes the snoozed thread.
     */
    it('a thread named by a Notion MCP address is the same thread', async () => {
      const { client } = await connected(REVIEWING());
      const answer = await call(client, 'queue_notification', {
        ...aNotification(),
        discussion_id: `discussion://${PAGE}/${PAGE}/${THREAD}`,
      });

      expect(answer.isError).toBe(true);
      expect(textOf(answer)).toContain('the person snoozed this until');
    });

    /**
     * Buttons of a proposal from a snoozed thread also count as speaking about the snoozed matter.
     */
    it('a review includes no proposal from a snoozed thread in its packet', async () => {
      const waiting = randomUUID();

      await prisma.pendingAction.create({
        data: {
          id: waiting,
          notionPageId: PAGE,
          discussionId: THREAD,
          fingerprint: 'fp-waiting',
          effects: [],
          preconditions: [],
        },
      });

      const { client } = await connected(REVIEWING());
      const answer = await call(client, 'queue_notification', aNotification(waiting));

      expect(answer.isError).toBe(true);
      expect(textOf(answer)).toContain('the person snoozed this until');
    });

    it('a review speaks about another page', async () => {
      const { session, client } = await connected(REVIEWING());

      await call(client, 'add_comment', { page_id: OTHER_PAGE, text: 'Задача стоїть тиждень' });

      const report = await session.commit();

      expect(report.applied.map((effect) => effect.kind)).toEqual(['comment']);
    });

    /**
     * A new event about the snoozed matter may be critical: the run judges whether it is worth
     * mentioning.
     */
    it('a snooze does not hold back an event run', async () => {
      const { session, client } = await connected();

      await call(client, 'add_comment', { page_id: PAGE, discussion_id: THREAD, text: 'Добре' });

      const report = await session.commit();

      expect(report.applied.map((effect) => effect.kind)).toEqual(['comment']);
    });

    /** A snooze set while the run was thinking stops applying before the first write. */
    it('a snooze set during the run stops applying', async () => {
      await truncateAll(prisma);

      const { session, client } = await connected(REVIEWING());

      await call(client, 'add_comment', { page_id: PAGE, text: 'Задача стоїть тиждень' });
      await moduleRef.get(ContinuationsService).schedule(CHAT, PERSONS_SNOOZE);

      const report = await session.commit();

      expect(report.applied).toEqual([]);
      expect(report.failure).toContain('the person snoozed this until');
    });
  });

  /**
   * A comment in the system's voice (ADR 0017): the thread it opens has a provisional id, and the
   * writes of the same run that point to it get the real one when applied. Comments are applied
   * first.
   */
  describe("a comment in the system's voice", () => {
    const OPENING: ToolArguments['add_comment'] = {
      page_id: PAGE,
      text: 'Задача чекає на відповідь постачальника',
    };

    it('the thread a comment opened reaches the other writes under its real id', async () => {
      const { session, client } = await connected();
      const opened = jsonOf(await call(client, 'add_comment', OPENING));
      const provisional = z.string().parse(opened.discussion_id);

      await call(client, 'schedule_continuation', {
        discussion_id: provisional,
        page_id: PAGE,
        run_at: LATER,
        reason_code: 'await_external_event',
      });
      await call(client, 'create_pending_action', { ...A_PROPOSAL, discussion_id: provisional });
      await call(client, 'queue_notification', {
        ...aNotification(),
        discussion_id: provisional,
      });

      const report = await session.commit();
      const { discussionId: real } = await prisma.systemDiscussion.findFirstOrThrow();
      const threads = [
        (await prisma.scheduledCheck.findFirstOrThrow()).discussionId,
        (await prisma.pendingAction.findFirstOrThrow()).discussionId,
        (await prisma.notificationOutbox.findFirstOrThrow()).discussionId,
      ];

      expect(report.failure).toBeUndefined();
      expect(report.applied.map((effect) => effect.kind)).toEqual([
        'comment',
        'continuation',
        'proposal',
        'delivery',
      ]);
      expect(real).not.toBe(provisional);
      expect(threads).toEqual([real, real, real]);
    });

    it('a reply in a thread this run opened is added to that thread', async () => {
      const { session, client } = await connected();
      const opened = jsonOf(await call(client, 'add_comment', OPENING));
      const reply = jsonOf(
        await call(client, 'add_comment', {
          page_id: PAGE,
          discussion_id: z.string().parse(opened.discussion_id),
          text: 'Нагадаю завтра',
        }),
      );

      await session.commit();

      const { discussionId: real } = await prisma.systemDiscussion.findFirstOrThrow();
      const [, replied] = harness.notion.created;

      expect(reply.discussion_id).toBe(opened.discussion_id);
      expect(replied).toMatchObject({ discussion_id: real });
      await expect(prisma.systemDiscussion.count()).resolves.toBe(1);
    });

    /** A capability refusal is text for the model; the session stays usable. */
    it('an empty comment is refused on the call, and the rest is applied', async () => {
      const { session, client } = await connected();
      const refused = await call(client, 'add_comment', { page_id: PAGE, text: '   ' });

      await call(client, 'queue_notification', aNotification());

      const report = await session.commit();

      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('comment');
      expect(textOf(refused)).toContain('the text is empty');
      expect(report.applied.map((effect) => effect.kind)).toEqual(['delivery']);
      expect(harness.notion.created).toEqual([]);
    });

    /** A field the schema does not know is a refusal, not silence (`INV-090`). */
    it('an extra comment field is a refusal, not silence', async () => {
      const { client } = await connected();
      const refused = await callMalformed(client, 'add_comment', { ...OPENING, resolve: true });

      expect(refused.isError).toBe(true);
    });
  });

  /**
   * Conversion of an Inbox item is a system intent (ADR 0017): a Task, an origin comment on the
   * item, the trash. The new Task gets a provisional id, and the comment and continuation of the
   * same run get the real one when applied.
   */
  describe('conversion of an Inbox item', () => {
    const CAPTURING = grant('dialogue', { origin: 'inbox_capture' });
    const CONVERSION: ToolArguments['convert_inbox_item'] = {
      inbox_page_id: INBOX_ITEM,
      task: { name: 'Отримати відповідь банку', status: 'Waiting For', date: '2026-10-05' },
      comment: 'Стало задачею: чекаємо відповідь банку',
    };

    it('waits for the conclusion, and once applied yields the Task, the origin comment and the trash', async () => {
      const { session, client } = await connected({ ...CAPTURING, runId: randomUUID() });
      const staged = jsonOf(await call(client, 'convert_inbox_item', CONVERSION));
      const task = z.string().parse(staged.task_page_id);

      await call(client, 'add_comment', { page_id: task, text: 'Нагадаю, коли настане дата' });
      await call(client, 'schedule_continuation', {
        page_id: task,
        run_at: LATER,
        reason_code: 'await_external_event',
      });

      expect(harness.notion.sent).toEqual([]);

      const report = await session.commit();
      const [created] = report.applied;

      expect(report.failure).toBeUndefined();
      expect(report.applied.map((effect) => effect.kind)).toEqual([
        'page_created',
        'comment',
        'page_archived',
        'comment',
        'continuation',
      ]);
      expect(harness.notion.sent.map((write) => write.method)).toEqual([
        'pages.create',
        'comments.create',
        'pages.update',
        'comments.create',
      ]);
      expect(harness.notion.sent[2]).toMatchObject({
        params: { page_id: INBOX_ITEM, in_trash: true },
      });
      expect(harness.notion.sent[3]).toMatchObject({
        params: { parent: { page_id: created?.id } },
      });
      await expect(prisma.scheduledCheck.findFirstOrThrow()).resolves.toMatchObject({
        notionPageId: created?.id,
      });
    });

    /**
     * A write to Notion has no undo: what was done before the failure stays and is visible in the
     * report.
     */
    it('a stop in the middle leaves the Task among the applied and does not apply the rest', async () => {
      const { session, client } = await connected({ ...CAPTURING, runId: randomUUID() });

      await call(client, 'convert_inbox_item', CONVERSION);
      await call(client, 'queue_notification', aNotification());
      harness.notion.refusing = 'comments.create';

      const report = await session.commit();

      expect(report.applied.map((effect) => effect.kind)).toEqual(['page_created']);
      expect(report.failure).toContain('validation_error');
      await expect(prisma.notificationOutbox.count()).resolves.toBe(0);
    });

    /**
     * Notion accepted the creation of the Task but attributed it to someone other than the
     * integration bot (the `NOTION_API_TOKEN` of a foreign integration). The Task is already in
     * the workspace, so it is among the applied, with its id. Otherwise the duplicate that a retry
     * of the run would create would not be visible.
     */
    it('a Task that Notion attributed to someone other than the bot stays among the applied', async () => {
      const { session, client } = await connected({ ...CAPTURING, runId: randomUUID() });

      await call(client, 'convert_inbox_item', CONVERSION);
      await call(client, 'queue_notification', aNotification());
      harness.notion.signedBy = 'another-integration';

      const report = await session.commit();

      expect(report.applied.map((effect) => effect.kind)).toEqual(['page_created']);
      expect(report.failure).toContain('attributed it to another-integration');
      expect(harness.notion.sent.map((write) => write.method)).toEqual(['pages.create']);
      await expect(prisma.notificationOutbox.count()).resolves.toBe(0);
    });

    it('outside a conversation there is nothing to convert with', async () => {
      const { client } = await connected();
      const { tools } = await client.listTools();

      expect(tools.map((tool) => tool.name)).not.toContain('convert_inbox_item');
    });
  });
});
