import {
  addHours,
  addMinutes,
  addSeconds,
  subDays,
  subHours,
  subMinutes,
  subSeconds,
} from 'date-fns';
import { EvaluationWindow } from '../../src/generated/prisma/client';
import { evaluationWindowConfig } from '../../src/intake/notion/evaluation-window.config';
import { ClaimedRun } from '../../src/runs/run-source';
import { failed } from '../fixtures/run-outcome.fixture';
import {
  buildIntakeHarness,
  commentEvent,
  ENCODED_PROPERTY,
  ENCODED_PROPERTY_RAW,
  IGNORED_PROPERTY,
  IntakeHarness,
  propertyEvent,
  WATCHED_ID,
  WATCHED_PROPERTY,
} from './intake.harness';
import { fillDay, runningRun } from './ledger-rows';
import { claimed } from './queue-rows';

/**
 * The evaluation window's debounce: absorption of events, the ceiling and coming due as a run.
 *
 * It also checks that closed run gates leave a window untouched: neither its time, nor its
 * attempts, nor its status (`INV-084`).
 */
describe('evaluation window', () => {
  let harness: IntakeHarness;

  beforeAll(async () => {
    harness = await buildIntakeHarness();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.close();
  });

  const only = (): Promise<EvaluationWindow> => harness.prisma.evaluationWindow.findFirstOrThrow();

  const makeDue = async (): Promise<void> => {
    await harness.prisma.evaluationWindow.updateMany({
      data: { notBefore: subSeconds(new Date(), 1) },
    });
  };

  /** Claims the only window the way the scheduler takes it: by id, before a run. */
  const claimOnly = async (): Promise<ClaimedRun> => claimed(harness.windowRuns, (await only()).id);

  /** Checks that the window is as it was, up to the transition timestamp. */
  const expectUntouched = async (before: EvaluationWindow): Promise<void> => {
    const after = await only();
    const expected: EvaluationWindow = { ...before, updatedAt: after.updatedAt };

    expect(after).toEqual(expected);
  };

  it('a new window comes due no sooner than after the quiet period', async () => {
    await harness.intake.accept(propertyEvent());

    const window = await only();

    expect(window.notBefore.getTime()).toBeGreaterThan(addSeconds(new Date(), 50).getTime());
    await expect(harness.scheduler.runOnce()).resolves.toBe(0);
  });

  /**
   * The configuration is deployed while the runner is switched off (ADR 0013), so there is no
   * launcher and the run gates are closed for everyone. The window waits as it was: what waits is
   * the scheduler, not the row.
   */
  it('without a launcher the window waits as it was', async () => {
    harness.launcher.available = false;

    await harness.intake.accept(propertyEvent());
    await makeDue();

    const before = await only();

    await expect(harness.scheduler.runOnce()).resolves.toBe(0);

    expect(harness.launcher.launched).toHaveLength(0);
    await expectUntouched(before);
  });

  /**
   * A queue with no consumer grows: while there is no launcher, the window waits, and it cannot
   * exhaust its attempts, since an attempt is recorded only before a run and there is no run. A
   * window without a launcher is immortal by construction, so only a rule that looks at time can
   * retire it.
   */
  describe('a window that has received nothing for a long time', () => {
    const horizon = evaluationWindowConfig().maxAgeDays;

    const age = (lastEventDaysAgo: number, createdDaysAgo: number) =>
      harness.prisma.evaluationWindow.updateMany({
        data: {
          createdAt: subDays(new Date(), createdDaysAgo),
          latestEventAt: subDays(new Date(), lastEventDaysAgo),
          notBefore: subSeconds(new Date(), 1),
          lastError: 'run reported failure',
        },
      });

    it('is retired with a named reason and is not made claimable again', async () => {
      await harness.intake.accept(propertyEvent());
      await age(horizon + 1, horizon + 1);

      await harness.windowRuns.retire();

      await expect(harness.windowRuns.candidates()).resolves.toHaveLength(0);

      const dead = await only();

      expect(dead.status).toBe('failed');
      // Both facts: why it died and what last happened to it. The second half says the most
      // here, because it tells “no run ever happened” from “the runs failed every time”.
      expect(dead.lastError).toBe(`no new event for ${horizon}d (last: run reported failure)`);
    });

    /**
     * Age is measured from the last event, not from creation (`contracts/canonical.yaml`, key
     * `evaluation_window`). This catches retirement based on the age of the first event: it would
     * throw out today's change because the first one was long ago.
     */
    it('an old page with a fresh event stays open', async () => {
      await harness.intake.accept(propertyEvent());
      await age(0, horizon + 30);

      await harness.windowRuns.retire();

      await expect(harness.windowRuns.candidates()).resolves.toHaveLength(1);
    });
  });

  it('changed properties are combined without repeats', async () => {
    await harness.intake.accept(propertyEvent());
    await harness.intake.accept(
      propertyEvent({ data: { updated_properties: [IGNORED_PROPERTY, WATCHED_PROPERTY] } }),
    );

    const window = await only();

    expect([...window.updatedProperties].sort()).toEqual([WATCHED_ID, IGNORED_PROPERTY].sort());
    expect(window.eventTypes).toEqual(['page.properties_updated']);
  });

  /**
   * Two forms of one id are not two different ids. Without translation at ingress the window would
   * accumulate duplicates, and the envelope would pass the model a list in which one property is
   * named twice and differently.
   */
  it('two forms of the same id are combined into one entry', async () => {
    await harness.intake.accept(
      propertyEvent({ data: { updated_properties: [ENCODED_PROPERTY] } }),
    );
    await harness.intake.accept(
      propertyEvent({ data: { updated_properties: [ENCODED_PROPERTY_RAW] } }),
    );

    const window = await only();

    expect(window.updatedProperties).toEqual([ENCODED_PROPERTY_RAW]);
  });

  /**
   * The form of an ID on the wire is not measured, and the receipt is the only evidence of it: it
   * stores IDs as they arrived, and the window stores the canonical form. Otherwise there would be
   * nothing to measure, and reprocessing receipts would decode a second time.
   */
  it('the receipt stores the id in the wire form, the window in the canonical one', async () => {
    await harness.intake.accept(
      propertyEvent({ data: { updated_properties: [ENCODED_PROPERTY] } }),
    );

    const receipt = await harness.prisma.webhookReceipt.findFirstOrThrow();

    expect(receipt.diagnostics).toMatchObject({ updated_properties: [ENCODED_PROPERTY] });
    await expect(only()).resolves.toMatchObject({ updatedProperties: [ENCODED_PROPERTY_RAW] });
  });

  const envelopeAfterRun = async (): Promise<string> => {
    await makeDue();
    await harness.scheduler.runOnce();

    const [envelope] = harness.launcher.launched;

    return envelope.trigger.type;
  };

  it('event types are combined, and the envelope type comes from the event that closed the window', async () => {
    await harness.intake.accept(propertyEvent());
    await harness.intake.accept(commentEvent('discussion-1'));

    const window = await only();

    expect([...window.eventTypes].sort()).toEqual(['comment.created', 'page.properties_updated']);
    await expect(envelopeAfterRun()).resolves.toBe('comment.created');
  });

  /**
   * An edit of the page body is a reason to reread the body, and a property edit that closed the
   * window after it does not erase that reason: the envelope contains all the window's types
   * (ADR 0040).
   */
  it('a body edit followed by a property change stays in the envelope', async () => {
    await harness.intake.accept(
      propertyEvent({
        type: 'page.content_updated',
        data: { parent: { data_source_id: 'ds_task', type: 'data_source' } },
      }),
    );
    await harness.intake.accept(propertyEvent());
    await makeDue();
    await harness.scheduler.runOnce();

    const [envelope] = harness.launcher.launched;

    expect(envelope.trigger).toMatchObject({
      type: 'page.properties_updated',
      event_types: ['page.content_updated', 'page.properties_updated'],
    });
  });

  /**
   * The type is taken from its own column, not from the last element of `event_types`: the set is
   * sorted, so the last element is not the last type, and the envelope would name a comment when
   * a property edit closed the window. The model would wake with a false reason.
   */
  it('a repeated type does not confuse the envelope', async () => {
    await harness.intake.accept(propertyEvent());
    await harness.intake.accept(commentEvent('discussion-1'));
    await harness.intake.accept(propertyEvent());

    await expect(envelopeAfterRun()).resolves.toBe('page.properties_updated');
  });

  /**
   * The merge computes the union in the statement itself, not in JS over a snapshot read earlier.
   * Otherwise deliveries that arrive at the same time take the same snapshot, and the properties
   * of the delivery that wrote first disappear without a trace, with a receipt marked
   * `processed`, that is, with no hint that the event happened.
   */
  it('events that arrive together do not overwrite the properties of one another', async () => {
    // Each event has the watched property (otherwise the relevance gate rejects it) and one of
    // its own, which shows whether it arrived.
    const marks = Array.from({ length: 10 }, (_, index) => `p_concurrent_${index}`);

    await Promise.all(
      marks.map((mark) =>
        harness.intake.accept(
          propertyEvent({ data: { updated_properties: [WATCHED_PROPERTY, mark] } }),
        ),
      ),
    );

    const window = await only();

    expect([...window.updatedProperties].sort()).toEqual([WATCHED_ID, ...marks].sort());
  });

  /**
   * The provider redelivers up to eight times within a day, so a late copy of an old event is
   * routine, not an anomaly. Without `GREATEST` the copy would overwrite the mark with an older
   * value, and the time in the envelope (`INV-030`) would go backwards.
   */
  it('a late copy of an old event does not move the window time backwards', async () => {
    const newer = new Date();
    const older = subHours(newer, 1);

    await harness.intake.accept(propertyEvent({ id: 'evt-newer', timestamp: newer.toISOString() }));
    await harness.intake.accept(
      propertyEvent({ id: 'evt-older', type: 'comment.created', timestamp: older.toISOString() }),
    );

    const window = await only();

    expect(window.latestEventAt.getTime()).toBe(newer.getTime());
    expect(window.latestEventId).toBe('evt-newer');
    expect(window.latestEventType).toBe('page.properties_updated');
  });

  /**
   * The window may have closed between the read and the write. A write to a terminal row leads
   * nowhere, since no one will claim it any more, so the event opens a new window instead of
   * landing in a closed one and vanishing.
   */
  it('an event for an already closed window opens a new one', async () => {
    await harness.intake.accept(propertyEvent());
    await harness.prisma.evaluationWindow.updateMany({ data: { status: 'done' } });

    await harness.intake.accept(propertyEvent());

    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(2);
    await expect(
      harness.prisma.evaluationWindow.count({ where: { status: 'pending' } }),
    ).resolves.toBe(1);
  });

  /**
   * Without the ceiling, continuous editing would push `not_before` back endlessly, and the
   * evaluation would never happen.
   */
  it('the ceiling from creation does not let the window be pushed back endlessly', async () => {
    await harness.intake.accept(propertyEvent());

    const opened = await only();
    const longAgo = subSeconds(new Date(), 290);

    // Both dates move: a real window created 290 seconds ago also has a `not_before` from that
    // same time. The code does not produce an old creation date with a fresh `not_before`.
    await harness.prisma.evaluationWindow.update({
      where: { id: opened.id },
      data: { createdAt: longAgo, notBefore: addMinutes(longAgo, 1) },
    });

    await harness.intake.accept(propertyEvent());

    const merged = await only();

    expect(merged.notBefore).toEqual(
      addSeconds(longAgo, evaluationWindowConfig().maxWindowSeconds),
    );
  });

  /**
   * The ceiling limits **pushing back** and does not pull forward: the merge only pushes the
   * window time back and does not cancel an assigned time. Otherwise a window with a time beyond
   * the ceiling would become due immediately, because the ceiling is long in the past, and the
   * debounce would vanish.
   */
  it('an event does not pull forward a window time that is beyond the ceiling', async () => {
    await harness.intake.accept(propertyEvent());

    const opened = await only();
    const tomorrow = addHours(new Date(), 20);

    await harness.prisma.evaluationWindow.update({
      where: { id: opened.id },
      data: { createdAt: subMinutes(new Date(), 10), notBefore: tomorrow },
    });

    await harness.intake.accept(propertyEvent());

    const merged = await only();

    expect(merged.notBefore.getTime()).toBe(tomorrow.getTime());
    expect(merged.version).toBeGreaterThan(opened.version);
  });

  it('a window that came due becomes a run and closes', async () => {
    await harness.intake.accept(propertyEvent());
    await makeDue();

    await expect(harness.scheduler.runOnce()).resolves.toBe(1);

    const window = await only();

    expect(window.status).toBe('done');
    expect(harness.launcher.launched).toHaveLength(1);

    const [envelope] = harness.launcher.launched;

    expect(envelope.mode).toBe('event_evaluation');
    expect(envelope.trigger).toMatchObject({ page_id: 'page-1' });
  });

  it('the envelope contains changed properties under the canonical name', async () => {
    await harness.intake.accept(propertyEvent());
    await makeDue();
    await harness.scheduler.runOnce();

    const [envelope] = harness.launcher.launched;

    expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
      trigger: { updated_property_ids: [WATCHED_ID] },
    });
  });

  it('a run leaves its origin and the origin row in the ledger', async () => {
    await harness.intake.accept(propertyEvent());
    await makeDue();
    await harness.scheduler.runOnce();

    const trace = await harness.prisma.runTrace.findFirstOrThrow();
    const window = await only();

    expect(trace.originKind).toBe('evaluation_window');
    expect(trace.originId).toBe(window.id);
    expect(trace.budgetClass).toBe('budgeted');
  });

  describe('closed run gates', () => {
    it('with the daily limit exhausted, the window waits as it was', async () => {
      await harness.intake.accept(propertyEvent());
      await makeDue();
      await fillDay(harness.prisma);

      const before = await only();

      await expect(harness.scheduler.runOnce()).resolves.toBe(0);

      await expectUntouched(before);
      expect(harness.launcher.launched).toHaveLength(0);
    });

    /**
     * The row's limit is protected from the thing that guards it: a run that did not happen does
     * not count against the row.
     */
    it('a daily limit exhausted many times in a row does not kill the window', async () => {
      await harness.intake.accept(propertyEvent());
      await makeDue();
      await fillDay(harness.prisma);

      const before = await only();

      for (let tick = 0; tick < 6; tick += 1) {
        await expect(harness.scheduler.runOnce()).resolves.toBe(0);
      }

      await expectUntouched(before);
      expect(harness.launcher.launched).toHaveLength(0);
    });

    it('with the slot occupied, the window waits as it was', async () => {
      await harness.intake.accept(propertyEvent());
      await makeDue();
      await harness.prisma.runTrace.create({
        data: runningRun(0, inAnHour()),
      });

      const before = await only();

      await expect(harness.scheduler.runOnce()).resolves.toBe(0);

      await expectUntouched(before);
    });
  });

  /**
   * The row is claimed right before the run, and `running` means that the run has started: the
   * claim does not set it, the attempt writes it.
   */
  it('a claimed window becomes `running` only with an attempt', async () => {
    await harness.intake.accept(propertyEvent());
    await makeDue();

    const claimed = await claimOnly();

    await expect(only().then((row) => row.status)).resolves.toBe('pending');
    await expect(claimed.recordAttempt()).resolves.toBe(true);

    const attempted = await only();

    expect(attempted.status).toBe('running');
    expect(attempted.attemptCount).toBe(1);
    expect(attempted.lastAttemptAt).not.toBeNull();
  });

  /**
   * A retried row has already had its run and failed, while a fresh window has had none, so the
   * fresh window goes first although it came due later (`INV-085`). For this the source must put
   * forward both: the earliest fresh window and the earliest retry.
   */
  it('a fresh window goes ahead of an older retry', async () => {
    await harness.intake.accept(propertyEvent({ entity: { id: 'page-retried', type: 'page' } }));
    await harness.intake.accept(propertyEvent({ entity: { id: 'page-fresh', type: 'page' } }));
    await harness.prisma.evaluationWindow.updateMany({
      where: { pageId: 'page-retried' },
      data: { notBefore: subMinutes(new Date(), 10), attemptCount: 1 },
    });
    await harness.prisma.evaluationWindow.updateMany({
      where: { pageId: 'page-fresh' },
      data: { notBefore: subSeconds(new Date(), 1) },
    });

    await expect(harness.scheduler.runOnce()).resolves.toBe(1);

    expect(harness.launcher.launched.map(({ trigger }) => trigger)).toEqual([
      expect.objectContaining({ page_id: 'page-fresh' }),
    ]);
  });

  /**
   * A run that took place and reported a failure does not close the window, because the reason to
   * look at the page has not gone away, and the unavailability of the model or Notion is retried
   * with the same profile (`INV-032`). The retry limit is enforced by `attempt_count`.
   */
  it('a run that reported a failure does not close the window and is retried', async () => {
    harness.launcher.outcome = failed('notion unreachable');

    await harness.intake.accept(propertyEvent());
    await makeDue();
    await harness.scheduler.runOnce();

    const after = await only();

    expect(after.status).toBe('running');
    expect(after.attemptCount).toBe(1);
    expect(after.lockedUntil).toBeNull();
    await expect(harness.prisma.runTrace.count()).resolves.toBe(1);

    await expect(harness.scheduler.runOnce()).resolves.toBe(1);
    await expect(harness.prisma.runTrace.count()).resolves.toBe(2);
  });

  it('a window that exhausted its attempt limit moves to `failed` and asks for no more runs', async () => {
    harness.launcher.outcome = failed('notion unreachable');

    await harness.intake.accept(propertyEvent());
    await makeDue();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(harness.scheduler.runOnce()).resolves.toBe(1);
    }

    await expect(harness.scheduler.runOnce()).resolves.toBe(0);

    const retired = await only();

    expect(retired.status).toBe('failed');
    await expect(harness.prisma.runTrace.count()).resolves.toBe(3);
  });

  /**
   * The run did not die but hung for longer than the lease.
   *
   * The next tick has already claimed the row, and the late conclusion of the first run concerns
   * work that no one is waiting for any more. The row id is not enough for the write, because it
   * stays the same after a reclaim. The lease stamp is the owner token. It keeps a zombie from
   * closing someone else's window, together with the events that were absorbed into it after the
   * reclaim.
   */
  describe('a zombie with an expired lease', () => {
    const expire = async (): Promise<void> => {
      await harness.prisma.evaluationWindow.updateMany({
        data: { lockedUntil: subSeconds(new Date(), 1) },
      });
    };

    /**
     * Reclaims the row: the same row, the same version, different leaseholders. The second claim
     * also returns the lease it set, which the zombie must not release.
     */
    const reclaim = async (): Promise<[ClaimedRun, ClaimedRun, Date | null]> => {
      await harness.intake.accept(propertyEvent());
      await makeDue();

      const first = await claimOnly();
      const { version } = await only();

      await expire();

      const second = await claimOnly();
      const reclaimed = await only();

      expect(second.id).toBe(first.id);
      expect(reclaimed.version).toBe(version);

      return [first, second, reclaimed.lockedUntil];
    };

    it('a live lease cannot be claimed a second time', async () => {
      await harness.intake.accept(propertyEvent());
      await makeDue();
      await claimOnly();

      await expect(harness.windowRuns.claim((await only()).id)).resolves.toBeNull();
    });

    it("a late closure does not close someone else's window", async () => {
      const [first, , lease] = await reclaim();

      await expect(first.conclude(false)).resolves.toBe('lost');

      const after = await only();

      // The status is the one the second claim left: its run has not started yet.
      expect(after.status).toBe('pending');
      expect(after.lockedUntil?.getTime()).toBe(lease?.getTime());
    });

    const stale: [string, (first: ClaimedRun) => Promise<boolean>][] = [
      ['release', (first) => first.release()],
      ['release with a reason', (first) => first.fail('stale', false)],
      ['attempt refund', (first) => first.refund('stale', false)],
    ];

    it.each(stale)("a late %s on someone else's lease does not release it", async (_, dispose) => {
      const [first, , lease] = await reclaim();

      await expect(dispose(first)).resolves.toBe(false);

      const after = await only();

      expect(after.lockedUntil?.getTime()).toBe(lease?.getTime());
      expect(after.lastError).toBeNull();
      expect(after.attemptCount).toBe(0);
    });

    /**
     * The attempt is charged to whoever launches the run, not to the one whose run already belongs
     * to no one.
     */
    it("a late recording of an attempt does not charge someone else's window", async () => {
      const [first] = await reclaim();

      await expect(first.recordAttempt()).resolves.toBe(false);
      await expect(only().then((row) => row.attemptCount)).resolves.toBe(0);
    });
  });

  /**
   * Pruning measures a window's age from the last transition, not from creation. The closing is
   * written by a raw statement that the Prisma client does not see, and without a transition
   * timestamp of its own a window that waited for weeks and has just closed would be pruned
   * immediately.
   */
  it('closing marks the transition', async () => {
    await harness.intake.accept(propertyEvent());
    await makeDue();

    const claimed = await claimOnly();

    await harness.prisma.$executeRaw`
      UPDATE "evaluation_windows" SET "updated_at" = now() - make_interval(days => 30)
    `;

    await expect(claimed.conclude(false)).resolves.toBe('closed');
    await expect(only().then((row) => row.updatedAt.getTime())).resolves.toBeGreaterThan(
      subMinutes(new Date(), 1).getTime(),
    );
  });

  /**
   * A merge that landed between the claim and the denial sets a new time on the window: the quiet
   * period after the new event. The release after a denial leaves the row as it is, together with
   * what was absorbed (`INV-084`).
   */
  it('a release after a denial leaves the time that the merge set', async () => {
    await harness.intake.accept(propertyEvent());
    await makeDue();

    const claimed = await claimOnly();

    await harness.intake.accept(
      propertyEvent({ data: { updated_properties: ['p_task_deadline'] } }),
    );

    const merged = await only();

    await expect(claimed.release()).resolves.toBe(true);

    const after = await only();
    const expected: Pick<
      EvaluationWindow,
      'notBefore' | 'lockedUntil' | 'lastError' | 'attemptCount' | 'status'
    > = {
      notBefore: merged.notBefore,
      lockedUntil: null,
      lastError: null,
      attemptCount: 0,
      status: 'pending',
    };

    expect(after).toMatchObject(expected);
  });

  describe('an event that arrives during dispatch', () => {
    /**
     * The partial index does not let a second window be created, so the event is absorbed into
     * the window that has already gone out with the snapshot it read, and an unconditional closing
     * would discard the event forever, with its receipt already done and no trace at all.
     */
    it('does not let the window be closed and makes it claimable again together with the changes', async () => {
      await harness.intake.accept(propertyEvent());
      await makeDue();

      const claimed = await claimOnly();

      await claimed.recordAttempt();
      await harness.intake.accept(
        propertyEvent({ data: { updated_properties: ['p_task_deadline'] } }),
      );

      await expect(claimed.conclude(false)).resolves.toBe('superseded');

      const after = await only();

      expect(after.status).toBe('running');
      expect(after.lockedUntil).toBeNull();
      expect(after.updatedProperties).toContain('p_task_deadline');
      expect(after.lastError).toContain('changed while the run was in flight');
    });

    /**
     * A run during which something was absorbed into the window took place and succeeded; only its
     * conclusion was left incomplete, so the attempt is refunded. Otherwise three edits during
     * three runs would eat up the limit, and everything that was absorbed would vanish along with
     * the row.
     */
    it('successful runs interrupted by a merge do not exhaust the attempt limit', async () => {
      await harness.intake.accept(propertyEvent());

      for (let round = 0; round < 4; round += 1) {
        await makeDue();

        const claimed = await claimOnly();

        // The same as the dispatcher does: the attempt is recorded before the launch.
        await claimed.recordAttempt();
        await harness.intake.accept(
          propertyEvent({ data: { updated_properties: [WATCHED_PROPERTY, `p_round_${round}`] } }),
        );

        await expect(claimed.conclude(false)).resolves.toBe('superseded');
      }

      const after = await only();

      expect(after.attemptCount).toBe(0);
      expect(after.status).toBe('running');

      // The main point: the row is still open. Without the attempt refund, the retirement before
      // the selection would put it into `failed`.
      await makeDue();
      await harness.windowRuns.retire();
      await expect(harness.windowRuns.candidates()).resolves.toHaveLength(1);
    });

    /**
     * A merge into a window that has reached the ceiling does not pull the time forward, which is
     * what the ceiling forbids. The replacement then provides a new quiet period: without it the
     * row would come due at once and go to a second run while the person is still typing.
     */
    it('a window at the ceiling, changed during a run, does not go straight to a second run', async () => {
      await harness.intake.accept(propertyEvent());
      await harness.prisma.evaluationWindow.updateMany({
        data: {
          createdAt: subMinutes(new Date(), 10),
          notBefore: subSeconds(new Date(), 1),
        },
      });

      const claimed = await claimOnly();

      await harness.intake.accept(
        propertyEvent({ data: { updated_properties: ['p_task_deadline'] } }),
      );

      expect((await only()).notBefore.getTime()).toBeLessThan(new Date().getTime());

      await expect(claimed.conclude(false)).resolves.toBe('superseded');
      await expect(only().then((row) => row.notBefore.getTime())).resolves.toBeGreaterThan(
        addSeconds(new Date(), 30).getTime(),
      );
    });

    /**
     * The same when the run did not reach Notion: the changed window waits not for a pause but for
     * a new quiet period.
     */
    it('a window at the ceiling, changed during a run that did not reach Notion, does not go straight to a second run', async () => {
      await harness.intake.accept(propertyEvent());
      await harness.prisma.evaluationWindow.updateMany({
        data: {
          createdAt: subMinutes(new Date(), 10),
          notBefore: subSeconds(new Date(), 1),
        },
      });

      const claimed = await claimOnly();

      await harness.intake.accept(
        propertyEvent({ data: { updated_properties: ['p_task_deadline'] } }),
      );

      await expect(claimed.waitForNotion('run deferred: Notion was not reached')).resolves.toBe(
        true,
      );

      const window = await only();

      expect(window.notionHoldUntil).toBeNull();
      expect(window.notBefore.getTime()).toBeGreaterThan(addSeconds(new Date(), 30).getTime());
    });

    /** End to end: the same through the scheduler while the run is held inside the port. */
    it('the window survives a run during which a new event arrived', async () => {
      let release!: () => void;

      harness.launcher.hold = new Promise<void>((resolve) => {
        release = resolve;
      });

      await harness.intake.accept(propertyEvent());
      await makeDue();

      // The barrier is armed before the tick that has to be caught inside the run: as a field
      // initializer it would resolve on the first launch in the file, and the event below would
      // land at an arbitrary time instead of inside the gap.
      const entered = harness.launcher.nextLaunch();
      const ticking = harness.scheduler.runOnce();

      await entered;

      expect(harness.launcher.launched).toHaveLength(1);

      await harness.intake.accept(
        propertyEvent({ data: { updated_properties: ['p_task_deadline'] } }),
      );

      release();
      await ticking;

      const after = await only();

      expect(after.status).not.toBe('done');
      expect(after.updatedProperties).toContain('p_task_deadline');

      harness.launcher.hold = undefined;
    });

    it('a window into which nothing was absorbed closes', async () => {
      await harness.intake.accept(propertyEvent());
      await makeDue();

      const claimed = await claimOnly();

      await expect(claimed.conclude(false)).resolves.toBe('closed');
      await expect(only().then((row) => row.status)).resolves.toBe('done');
    });
  });
});

function inAnHour(): Date {
  return addHours(new Date(), 1);
}
