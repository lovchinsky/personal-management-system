import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { connectToTestDatabase, truncateAll } from './database';

/**
 * `SCEN-64-33` The App's durable technical state is persisted in `app_db` (gate G5).
 *
 * What is checked is constraints, not column names: they, not the code, enforce “one active wake
 * and one active closure per thread”, “one open window”, “one delivery in the queue” and “one
 * open proposal”. The constraints are partial, so no type-level schema test covers them: a
 * database is needed.
 */

/** Returns the error code instead of asserting inside `catch`. */
async function violation(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : String(error);
  }

  return 'no-error';
}

describe('app_db enforces the continuity constraints', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  describe('attention continuations', () => {
    const thread = (
      discussionId: string | null,
      reasonCode: Prisma.ScheduledCheckCreateInput['reasonCode'],
    ) =>
      prisma.scheduledCheck.create({
        data: { discussionId, notionPageId: 'page-1', runAt: new Date(), reasonCode },
      });

    it('a thread has one active wake', async () => {
      await thread('discussion-1', 'user_snooze');

      await expect(violation(() => thread('discussion-1', 'safety_recheck'))).resolves.toBe(
        'P2002',
      );
    });

    it('thread closure is counted separately: it coexists with a wake, but a second closure is a duplicate', async () => {
      await thread('discussion-1', 'user_snooze');
      await thread('discussion-1', 'resolution_reconciliation');

      await expect(prisma.scheduledCheck.count()).resolves.toBe(2);
      await expect(
        violation(() => thread('discussion-1', 'resolution_reconciliation')),
      ).resolves.toBe('P2002');
    });

    it('without a thread, two different `reason_code` values on one page are not a duplicate', async () => {
      await thread(null, 'safety_recheck');
      await thread(null, 'deadline_followup');

      await expect(prisma.scheduledCheck.count()).resolves.toBe(2);
    });

    it('without a thread, the same `reason_code` on the same page is a duplicate', async () => {
      await thread(null, 'safety_recheck');

      await expect(violation(() => thread(null, 'safety_recheck'))).resolves.toBe('P2002');
    });

    it('a terminal row does not count toward the limit of one', async () => {
      const first = await thread(null, 'safety_recheck');

      await prisma.scheduledCheck.update({ where: { id: first.id }, data: { status: 'done' } });
      await thread(null, 'safety_recheck');

      await expect(prisma.scheduledCheck.count()).resolves.toBe(2);
    });
  });

  describe('evaluation window (debounce)', () => {
    const window = () =>
      prisma.evaluationWindow.create({
        data: {
          pageId: 'page-1',
          updatedProperties: ['aGCp'],
          eventTypes: ['page.properties_updated'],
          latestEventId: 'evt-1',
          latestEventType: 'page.properties_updated',
          latestEventAt: new Date(),
          notBefore: new Date(),
        },
      });

    it('a page has one open window', async () => {
      await window();

      await expect(violation(window)).resolves.toBe('P2002');
    });

    it('a closed window does not block a new one', async () => {
      const first = await window();

      await prisma.evaluationWindow.update({ where: { id: first.id }, data: { status: 'done' } });
      await window();

      await expect(prisma.evaluationWindow.count()).resolves.toBe(2);
    });
  });

  it('a logical delivery is queued once', async () => {
    const queued = () =>
      prisma.notificationOutbox.create({
        data: { idempotencyKey: 'nudge-1', channel: 'telegram', payload: { ask: 'decide' } },
      });

    await queued();

    await expect(violation(queued)).resolves.toBe('P2002');
  });

  describe('proposal', () => {
    const proposal = () =>
      prisma.pendingAction.create({
        data: {
          fingerprint: 'fp-1',
          notionPageId: 'page-1',
          effects: [
            {
              kind: 'property_write',
              pageId: 'page-1',
              propertyId: 'p_status',
              value: { kind: 'option', option: 'Next Action' },
            },
          ],
          preconditions: [{ kind: 'page_exists', pageId: 'page-1' }],
        },
      });

    it('there are never two open proposals with the same fingerprint', async () => {
      await proposal();

      await expect(violation(proposal)).resolves.toBe('P2002');
    });

    it('a terminal proposal does not block a new one', async () => {
      const first = await proposal();

      await prisma.pendingAction.update({
        where: { id: first.id },
        data: { status: 'executed', resolvedAt: new Date() },
      });
      await proposal();

      await expect(prisma.pendingAction.count()).resolves.toBe(2);
    });
  });
});
