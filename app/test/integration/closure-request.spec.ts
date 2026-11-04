import { Test } from '@nestjs/testing';
import { addHours } from 'date-fns';
import { appConfig } from '../../src/config/app.config';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { REASON_CLASS } from '../../src/continuations/reason-class';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { ReasonCode } from '../../src/generated/prisma/enums';
import { databaseConfig } from '../../src/platform/db/database.config';
import { isUniqueViolation } from '../../src/platform/db/prisma-errors';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { CHAT } from '../../src/runs/actor';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { runsConfig } from '../../src/runs/runs.config';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';
import { claimed, due } from './queue-rows';

/**
 * Closure of a thread that the App found resolved, against a real queue. The closure has a place
 * of its own, separate from the thread's wake. It does not move the wake, is not moved by it, is
 * idempotent while open, and wakes `closure_processing`, not a recheck (`INV-095`).
 */
describe('thread closure through the continuation queue', () => {
  const THREAD = { discussionId: 'discussion-1', notionPageId: 'page-1' };

  let prisma: PrismaService;
  let continuations: ContinuationsService;
  let runs: ScheduledCheckRunSource;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, appConfig, budgetConfig, runsConfig)],
      providers: [
        PrismaService,
        ScheduledCheckRepository,
        ContinuationsService,
        RunRowPolicy,
        ScheduledCheckRunSource,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    continuations = moduleRef.get(ContinuationsService);
    runs = moduleRef.get(ScheduledCheckRunSource);
    close = () => moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  const open = (): Promise<
    { id: string; reasonCode: string; version: number; runAt: Date; status: string }[]
  > =>
    prisma.scheduledCheck.findMany({
      select: { id: true, reasonCode: true, version: true, runAt: true, status: true },
      where: { status: { in: ['pending', 'running'] } },
      orderBy: { reasonCode: 'asc' },
    });

  const wake = (reasonCode: ReasonCode, at = addHours(new Date(), 5)): Promise<unknown> =>
    continuations.schedule(CHAT, { ...THREAD, runAt: at, reasonCode });

  it('a thread with no continuation gets a closure row, and the row wakes the closure', async () => {
    await expect(continuations.requestClosure(THREAD)).resolves.toBe('requested');
    await expect(open()).resolves.toMatchObject([
      { reasonCode: 'resolution_reconciliation', version: 0 },
    ]);

    const [candidate] = await runs.candidates();
    const claim = await candidate?.claim();

    expect(claim?.request.envelope.mode).toBe('closure_processing');
    expect(claim?.request.envelope.trigger).toMatchObject({
      type: 'closure_processing',
      discussion_id: THREAD.discussionId,
      page_id: THREAD.notionPageId,
      reason_code: 'resolution_reconciliation',
    });
  });

  /**
   * A closure takes a place of its own instead of moving someone else's: the thread's wake stays
   * as it was, with the same time, reason and version. That covers the person's snooze and the
   * deadline alike.
   */
  it.each(['await_external_event', 'user_snooze', 'deadline_followup'] as const)(
    'the %s wake coexists with a closure and stays unchanged',
    async (reasonCode) => {
      await wake(reasonCode);

      const [before] = await open();

      await expect(continuations.requestClosure(THREAD)).resolves.toBe('requested');

      const rows = await open();

      expect(rows.map((row) => row.reasonCode).sort()).toEqual(
        [reasonCode, 'resolution_reconciliation'].sort(),
      );
      expect(rows.find((row) => row.reasonCode === reasonCode)).toEqual(before);
    },
  );

  it('a wake scheduled after a closure does not move the closure', async () => {
    await continuations.requestClosure(THREAD);

    const [closing] = await open();

    await wake('await_external_event');
    await wake('safety_recheck');

    const rows = await open();

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.reasonCode === 'resolution_reconciliation')).toEqual(closing);
  });

  it('a repeated closure request changes nothing', async () => {
    await continuations.requestClosure(THREAD);

    const [first] = await open();

    await expect(continuations.requestClosure(THREAD)).resolves.toBe('already_requested');
    await expect(open()).resolves.toEqual([first]);
  });

  /**
   * A row that is already going into a run would become `superseded` if moved, and would run a
   * second time, with a second write to GBrain.
   */
  it('a closure already going into a run is not moved by a repeated request', async () => {
    await continuations.requestClosure(THREAD);

    const [candidate] = await runs.candidates();
    await claimed(runs, candidate?.id ?? '');

    const running = await prisma.scheduledCheck.findFirstOrThrow();

    expect(running.lockedUntil).not.toBeNull();
    await expect(continuations.requestClosure(THREAD)).resolves.toBe('already_requested');
    await expect(prisma.scheduledCheck.findFirstOrThrow()).resolves.toEqual(running);
    await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
  });

  it('after a completed closure a new resolution is a new closure', async () => {
    await continuations.requestClosure(THREAD);
    await prisma.scheduledCheck.updateMany({ data: { status: 'done' } });

    await expect(continuations.requestClosure(THREAD)).resolves.toBe('requested');
    await expect(prisma.scheduledCheck.count()).resolves.toBe(2);
    await expect(open()).resolves.toHaveLength(1);
  });

  it('concurrent requests yield one closure', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => continuations.requestClosure(THREAD)),
    );

    expect(outcomes.filter((outcome) => outcome === 'requested')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'already_requested')).toHaveLength(5);
    await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
  });

  /**
   * The read after a failed insert does not see the open closure although it exists: the second
   * insert runs into the index again, and the second read finds it. There is no duplicate.
   */
  it('a read that missed an open closure does not produce a second one', async () => {
    await continuations.requestClosure(THREAD);

    const unseen = jest.spyOn(prisma.scheduledCheck, 'findFirst').mockResolvedValueOnce(null);

    try {
      await expect(continuations.requestClosure(THREAD)).resolves.toBe('already_requested');
    } finally {
      unseen.mockRestore();
    }

    await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
  });

  it("a thread's wake and closure each go into a run with its own mode", async () => {
    await continuations.schedule(CHAT, {
      ...THREAD,
      runAt: due(),
      reasonCode: 'safety_recheck',
    });
    await continuations.requestClosure(THREAD);

    const modes: string[] = [];

    for (const candidate of await runs.candidates()) {
      const claim = await candidate.claim();

      modes.push(claim?.request.envelope.mode ?? 'unclaimed');
    }

    expect(modes.sort()).toEqual(['closure_processing', 'scheduled_recheck']);
  });

  /**
   * The model neither schedules nor moves a closure, so it is not in the model's state. The system
   * still counts the thread as occupied.
   */
  it('the thread state for the model does not show the closure, and the system sees the thread as managed', async () => {
    await continuations.requestClosure(THREAD);

    await expect(continuations.state({ discussionId: THREAD.discussionId }, [])).resolves.toEqual({
      continuations: [],
    });
    await expect(continuations.hasOpenFor(THREAD.discussionId)).resolves.toBe(true);

    await wake('await_external_event');

    const { continuations: shown } = await continuations.state(
      { discussionId: THREAD.discussionId },
      [],
    );

    expect(shown.map((row) => row.reason_code)).toEqual(['await_external_event']);
  });

  it('a recheck of the same thread remains a recheck', async () => {
    await continuations.schedule(CHAT, {
      ...THREAD,
      runAt: due(),
      reasonCode: 'safety_recheck',
    });

    const [candidate] = await runs.candidates();
    const claim = await candidate?.claim();

    expect(claim?.request.envelope.mode).toBe('scheduled_recheck');
  });

  /**
   * The class rule is stated twice: in `REASON_CLASS` and in the predicate of the partial indexes.
   * Every pair of reasons on one thread ties one copy to the other: the same class is a conflict,
   * a different class lets the insert through.
   */
  describe('indexes follow the reason class', () => {
    const pairs = Object.values(ReasonCode).flatMap((first) =>
      Object.values(ReasonCode).map((second) => [first, second] as const),
    );

    it.each(pairs)('%s and then %s on one thread', async (first, second) => {
      const discussionId = `matrix-${first}-${second}`;
      const row = (reasonCode: ReasonCode): Promise<unknown> =>
        prisma.scheduledCheck.create({
          data: { discussionId, notionPageId: 'page-1', runAt: new Date(), reasonCode },
        });

      await row(first);

      const sameClass = REASON_CLASS[first] === REASON_CLASS[second];
      const outcome = await row(second).then(
        () => 'inserted',
        (error: unknown) => (isUniqueViolation(error) ? 'conflict' : 'failed'),
      );

      expect(outcome).toBe(sameClass ? 'conflict' : 'inserted');
    });
  });
});
