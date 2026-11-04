import {
  buildIntakeHarness,
  commentEvent,
  IntakeHarness,
  OUR_BOT,
  propertyEvent,
} from './intake.harness';

/**
 * A proposal the person got ahead of is closed by the system (ADR 0044): intake sees a change
 * by the person on a page where a proposal waits and requests a check of its preconditions. The
 * system's own write and a comment about the page's state signal nothing: they place no request.
 */
describe('intake requests a check of a proposal the person may have gotten ahead of', () => {
  let harness: IntakeHarness;

  beforeAll(async () => {
    harness = await buildIntakeHarness();
  });

  beforeEach(async () => {
    await harness.reset();
    await harness.prisma.pendingAction.create({
      data: {
        id: '0197a1b2-0000-7000-8000-000000000001',
        notionPageId: 'page-1',
        fingerprint: 'fp-1',
        effects: [],
        preconditions: [],
      },
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  const requested = async (): Promise<boolean> =>
    (await harness.prisma.pendingAction.findFirstOrThrow()).recheckRequestedAt !== null;

  it('a property change by the person requests a check', async () => {
    await harness.intake.accept(propertyEvent());

    await expect(requested()).resolves.toBe(true);
  });

  it('a page deletion by the person requests a check', async () => {
    await harness.intake.accept(propertyEvent({ type: 'page.deleted', data: {} }));

    await expect(requested()).resolves.toBe(true);
  });

  it('a write by the system itself makes no request', async () => {
    await harness.intake.accept(propertyEvent({ authors: [{ id: OUR_BOT, type: 'bot' }] }));

    await expect(requested()).resolves.toBe(false);
  });

  it('a comment makes no request: it does not change the state of the page', async () => {
    await harness.intake.accept(commentEvent('5b6a4978-8a9b-4c1d-9e2f-3a4b5c6d7e8f'));

    await expect(requested()).resolves.toBe(false);
  });
});
