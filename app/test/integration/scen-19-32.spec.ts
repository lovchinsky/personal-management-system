import { subSeconds } from 'date-fns';
import {
  buildIntakeHarness,
  IGNORED_PROPERTY,
  IntakeHarness,
  propertyEvent,
} from './intake.harness';

/**
 * `SCEN-19-32` A duplicate webhook yields a single cognitive processing path.
 * The same tests also cover criterion 1 of gate M2: a duplicate event duplicates neither the
 * work nor the effect.
 *
 * The provider redelivers up to eight times within 24 hours, so a duplicate here is not
 * hypothetical but the expected course of events.
 */
describe('a duplicate event does not duplicate work', () => {
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

  it('the same event twice yields one receipt and one window', async () => {
    const event = propertyEvent();

    const first = await harness.intake.accept(event);
    const second = await harness.intake.accept({ ...event, attempt_number: 2 });

    expect(first.kind).toBe('absorbed');
    expect(second).toEqual({ kind: 'duplicate' });

    await expect(harness.prisma.webhookReceipt.count()).resolves.toBe(1);
    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(1);
  });

  it('a duplicate after the window comes due creates no second run', async () => {
    const event = propertyEvent();

    await harness.intake.accept(event);
    // The test writes straight to the row: it needs a due window, and only events and quiet
    // hours move the time of a window.
    await harness.prisma.evaluationWindow.updateMany({
      data: { notBefore: subSeconds(new Date(), 1) },
    });

    await expect(harness.scheduler.runOnce()).resolves.toBe(1);
    expect(harness.launcher.launched).toHaveLength(1);

    await expect(harness.intake.accept({ ...event, attempt_number: 3 })).resolves.toEqual({
      kind: 'duplicate',
    });
    await expect(harness.scheduler.runOnce()).resolves.toBe(0);

    expect(harness.launcher.launched).toHaveLength(1);
    await expect(harness.prisma.runTrace.count()).resolves.toBe(1);
  });

  describe('processing that did not finish', () => {
    /**
     * This is the costliest loss: if the row stayed `received`, the provider's redelivery would
     * see a “duplicate”, and the event would vanish forever — with a receipt in place and no
     * trace at all.
     * A transaction is not needed for this: absorbing into the window is idempotent, so the
     * redelivery simply finishes the work.
     */
    it('a provider redelivery continues the work instead of seeing a duplicate', async () => {
      const event = propertyEvent();

      // A crash between creating the receipt and the work: the row exists, the window does not.
      await harness.prisma.webhookReceipt.create({
        data: {
          source: 'notion',
          externalId: event.id,
          eventType: event.type,
          entityId: event.entity.id,
          diagnostics: {},
        },
      });

      await expect(harness.intake.accept(event)).resolves.toMatchObject({ kind: 'absorbed' });
      await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(1);
      await expect(harness.prisma.webhookReceipt.count()).resolves.toBe(1);
    });

    it('a settled event stays a duplicate', async () => {
      const event = propertyEvent();

      await harness.intake.accept(event);

      await expect(harness.intake.accept(event)).resolves.toEqual({ kind: 'duplicate' });
    });

    /** An event rejected by a rule is settled too: there is no point in redelivering it. */
    it('a rejected event stays a duplicate', async () => {
      const event = propertyEvent({ type: 'page.deleted', data: {} });

      await harness.intake.accept(event);

      await expect(harness.intake.accept(event)).resolves.toEqual({ kind: 'duplicate' });
    });

    it('a processing failure is recorded on the row and does not close the event', async () => {
      const event = propertyEvent();

      jest.spyOn(harness.windows, 'absorb').mockRejectedValueOnce(new Error('connection reset'));

      await expect(harness.intake.accept(event)).rejects.toThrow('connection reset');

      const receipt = await harness.prisma.webhookReceipt.findFirstOrThrow();

      expect(receipt.status).toBe('failed');
      expect(receipt.lastError).toBe('connection reset');
      expect(receipt.processedAt).toBeNull();

      // The provider's redelivery finishes the work.
      await expect(harness.intake.accept(event)).resolves.toMatchObject({ kind: 'absorbed' });
      await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(1);
    });
  });

  it('different events of the same page fold into one window', async () => {
    await harness.intake.accept(propertyEvent());
    await harness.intake.accept(propertyEvent());

    await expect(harness.prisma.webhookReceipt.count()).resolves.toBe(2);
    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(1);
  });

  /**
   * The result under concurrent calls: one window. This test does not guarantee that it reaches
   * the branch where a call loses the creation race (`P2002`), because the connection pool may
   * run the calls one after another. The test below covers that branch.
   *
   * That folding **loses no content** under concurrency is a separate assertion, and it lives in
   * `evaluation-window.spec.ts`: here all three events have the same property, so a loss would
   * go unnoticed.
   */
  it('concurrent events of the same page yield one window', async () => {
    await Promise.all([
      harness.intake.accept(propertyEvent()),
      harness.intake.accept(propertyEvent()),
      harness.intake.accept(propertyEvent()),
    ]);

    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(1);
  });

  /**
   * An event that lost the creation race is absorbed into the winning row instead of failing
   * with a raw `P2002`. The race is reproduced literally: the first fold “does not see” the open
   * window, so the creation runs into the partial unique index.
   */
  it('an event that lost the creation race is absorbed into the window that won', async () => {
    await harness.intake.accept(propertyEvent());

    const unseen = jest.spyOn(harness.prisma, '$queryRaw').mockResolvedValueOnce([]);
    let kind: string;

    try {
      const outcome = await harness.intake.accept(
        propertyEvent({ data: { updated_properties: ['p_task_deadline'] } }),
      );

      kind = outcome.kind;
    } finally {
      unseen.mockRestore();
    }

    expect(kind).toBe('absorbed');
    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(1);

    const window = await harness.prisma.evaluationWindow.findFirstOrThrow();

    expect(window.updatedProperties).toContain('p_task_deadline');
  });

  /**
   * A rejected event leaves a row with a reason. Without this difference “did not arrive”
   * cannot be told from “arrived and was not of interest”, and this difference is how intake
   * problems are diagnosed.
   */
  it('an irrelevant change is recorded as `rejected` with a reason', async () => {
    const outcome = await harness.intake.accept(
      propertyEvent({ data: { updated_properties: [IGNORED_PROPERTY] } }),
    );

    expect(outcome).toEqual({ kind: 'rejected', reason: 'no watched property changed' });

    const receipt = await harness.prisma.webhookReceipt.findFirstOrThrow();

    expect(receipt.status).toBe('rejected');
    expect(receipt.lastError).toBe('no watched property changed');
    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(0);
  });

  /**
   * The intersection rule applies only where a property list exists at all: `page.created` never
   * includes one.
   */
  it('page creation passes without a property list', async () => {
    const outcome = await harness.intake.accept(
      propertyEvent({
        type: 'page.created',
        data: { parent: { data_source_id: 'ds_inbox', type: 'data_source' } },
      }),
    );

    expect(outcome.kind).toBe('absorbed');
  });

  it('an event with no list and no known type is rejected with a named reason', async () => {
    const outcome = await harness.intake.accept(propertyEvent({ type: 'page.locked', data: {} }));

    expect(outcome).toEqual({
      kind: 'rejected',
      reason: 'event page.locked carries no property list',
    });
  });

  /** A note in the body of a Task or Project is the person's words, worth evaluating (ADR 0040). */
  describe('an edit to the page body', () => {
    const bodyEdit = (dataSourceId: string): ReturnType<typeof propertyEvent> =>
      propertyEvent({
        type: 'page.content_updated',
        data: { parent: { data_source_id: dataSourceId, type: 'data_source' } },
      });

    it.each(['ds_task', 'ds_project'])(
      'of a page from %s opens a window with no changed properties',
      async (source) => {
        await expect(harness.intake.accept(bodyEdit(source))).resolves.toMatchObject({
          kind: 'absorbed',
        });

        const window = await harness.prisma.evaluationWindow.findFirstOrThrow();

        expect(window.latestEventType).toBe('page.content_updated');
        expect(window.updatedProperties).toEqual([]);
      },
    );

    /**
     * A redelivery will not bring the page back: the event is rejected with a reason instead of
     * being retried.
     */
    it('of a page that no longer exists is rejected with a reason', async () => {
      harness.notion.gone.add('page-1');

      await expect(
        harness.intake.accept(propertyEvent({ type: 'page.content_updated', data: {} })),
      ).resolves.toEqual({
        kind: 'rejected',
        reason: 'page.content_updated of a page that is gone',
      });
    });

    it('of a page outside Tasks and Projects is rejected with a reason', async () => {
      await expect(harness.intake.accept(bodyEdit('ds_area_of_focus'))).resolves.toEqual({
        kind: 'rejected',
        reason: 'page.content_updated outside the Task and Project data sources',
      });
    });
  });

  it('a new reply in a discussion is relevant by construction and includes the thread', async () => {
    const outcome = await harness.intake.accept(
      propertyEvent({
        type: 'comment.created',
        entity: { id: 'comment-1', type: 'comment' },
        data: { discussion_id: 'discussion-1', page_id: 'page-1' },
      }),
    );

    expect(outcome.kind).toBe('absorbed');

    const window = await harness.prisma.evaluationWindow.findFirstOrThrow();

    expect(window.pageId).toBe('page-1');
    expect(window.discussionId).toBe('discussion-1');
  });

  it('a trashed page is recorded as `rejected` because it has no consumer yet', async () => {
    const outcome = await harness.intake.accept(
      propertyEvent({ type: 'page.deleted', authors: [{ type: 'bot', id: 'someone-else' }] }),
    );

    expect(outcome).toEqual({ kind: 'rejected', reason: 'page.deleted has no consumer yet' });
  });
});
