import { Test, TestingModule } from '@nestjs/testing';
import { subDays } from 'date-fns';
import { AttentionService } from '../../src/attention/attention.service';
import { SystemDiscussionRepository } from '../../src/attention/system-discussion.repository';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { evaluationWindowConfig } from '../../src/intake/notion/evaluation-window.config';
import { EvaluationWindowRunSource } from '../../src/intake/notion/evaluation-window.run-source';
import { WebhookReceiptRepository } from '../../src/intake/receipts/webhook-receipt.repository';
import { WebhookReceipts } from '../../src/intake/receipts/webhook-receipts';
import { maintenanceConfig } from '../../src/maintenance/maintenance.config';
import { MaintenanceWorker } from '../../src/maintenance/maintenance.worker';
import { OauthServer } from '../../src/mcp/oauth/oauth-server';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { ReviewOccurrenceRunSource } from '../../src/reviews/review-occurrence.run-source';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { runsConfig } from '../../src/runs/runs.config';
import { runSourcesProvider } from '../../src/scheduling/run-sources.provider';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

/**
 * Pruning what is garbage by construction.
 *
 * The reverse side is checked too: fresh rows are left untouched. Pruning that wipes out a live
 * receipt would break deduplication where the provider redelivers.
 */
describe('pruning', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let worker: MaintenanceWorker;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        testConfig(
          databaseConfig,
          maintenanceConfig,
          evaluationWindowConfig,
          budgetConfig,
          runsConfig,
          workersConfig,
        ),
      ],
      providers: [
        PrismaService,
        WebhookReceiptRepository,
        WebhookReceipts,
        RunRowPolicy,
        EvaluationWindowRunSource,
        ScheduledCheckRunSource,
        ReviewOccurrenceRunSource,
        runSourcesProvider,
        SystemDiscussionRepository,
        {
          // `AttentionService` is provided only with the part pruning uses: the rest of it
          // (Notion, proposals) is not needed here.
          provide: AttentionService,
          inject: [SystemDiscussionRepository],
          useFactory: (discussions: SystemDiscussionRepository) => {
            const attention: Pick<AttentionService, 'pruneStale'> = {
              pruneStale: (days) => discussions.pruneStale(days),
            };

            return attention;
          },
        },
        {
          // Pruning OAuth is not part of this check: it has its own tests.
          provide: OauthServer,
          useValue: { prune: () => Promise.resolve(0) } satisfies Pick<OauthServer, 'prune'>,
        },
        MaintenanceWorker,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    worker = moduleRef.get(MaintenanceWorker);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const receipt = (externalId: string, receivedAt: Date): Promise<unknown> =>
    prisma.webhookReceipt.create({
      data: {
        source: 'notion',
        externalId,
        eventType: 'page.properties_updated',
        diagnostics: {},
        receivedAt,
      },
    });

  const daysAgo = (days: number): Date => subDays(new Date(), days);

  /**
   * A queue row that reached a **conclusion** is a copy: only a successful run could have
   * concluded it, and that run left the same envelope and a back reference in `run_traces`. A
   * row that did **not** reach one is not a copy: there was no run, there is no trace, and the
   * row remains the only record of work the system did not do.
   */
  describe('queue rows that reached a conclusion', () => {
    const horizon = maintenanceConfig().receiptRetentionDays;

    const window = async (status: 'done' | 'failed', concludedDaysAgo: number, born = 0) => {
      const row = await prisma.evaluationWindow.create({
        data: {
          pageId: `page-${status}-${concludedDaysAgo}-${born}`,
          updatedProperties: [],
          eventTypes: ['page.properties_updated'],
          latestEventId: 'evt-1',
          latestEventType: 'page.properties_updated',
          latestEventAt: new Date(),
          notBefore: new Date(),
          status,
        },
      });

      // Prisma maintains `updated_at`, so the test sets it with a raw statement. Otherwise the
      // write that sets the age would itself overwrite it with the current time.
      await prisma.$executeRaw`
        UPDATE "evaluation_windows"
           SET "updated_at" = now() - make_interval(days => ${concludedDaysAgo}::int),
               "created_at" = now() - make_interval(days => ${born || concludedDaysAgo}::int)
         WHERE "id" = ${row.id}
      `;

      return row.id;
    };

    const survivors = (): Promise<string[]> =>
      prisma.evaluationWindow
        .findMany({ select: { id: true } })
        .then((rows) => rows.map((r) => r.id));

    it('an old `done` is pruned, an old `failed` is not', async () => {
      const concluded = await window('done', horizon + 1);
      const undone = await window('failed', horizon + 1);

      await worker.runOnce();

      await expect(survivors()).resolves.toEqual([undone]);
      expect(concluded).not.toBe(undone);
    });

    it('a fresh `done` stays', async () => {
      const fresh = await window('done', 1);

      await worker.runOnce();

      await expect(survivors()).resolves.toEqual([fresh]);
    });

    /**
     * The retention period is measured from the transition to a terminal state, not from
     * creation: a window could wait for weeks and finish yesterday. Otherwise pruning would wipe
     * out a conclusion reached only recently.
     */
    it('a window opened long ago but concluded only recently stays', async () => {
      const late = await window('done', 1, horizon + 30);

      await worker.runOnce();

      await expect(survivors()).resolves.toEqual([late]);
    });

    it('the same rule applies to continuations', async () => {
      const concluded = await prisma.scheduledCheck.create({
        data: {
          notionPageId: 'page-1',
          runAt: new Date(),
          reasonCode: 'safety_recheck',
          status: 'done',
        },
      });
      const undone = await prisma.scheduledCheck.create({
        data: {
          notionPageId: 'page-2',
          runAt: new Date(),
          reasonCode: 'safety_recheck',
          status: 'failed',
        },
      });

      await prisma.$executeRaw`
        UPDATE "scheduled_checks" SET "updated_at" = now() - make_interval(days => ${horizon + 1}::int)
      `;

      await worker.runOnce();

      const left = await prisma.scheduledCheck.findMany({ select: { id: true } });

      expect(left.map((row) => row.id)).toEqual([undone.id]);
      expect(concluded.id).not.toBe(undone.id);
    });
  });

  it('a receipt older than the provider redelivery window is pruned', async () => {
    await receipt('old', daysAgo(8));
    await receipt('fresh', daysAgo(1));

    await expect(worker.runOnce()).resolves.toBe(1);

    const left = await prisma.webhookReceipt.findMany();

    expect(left.map((row) => row.externalId)).toEqual(['fresh']);
  });

  /** The window is derived from the provider's 24 hours: a two-day-old receipt is still needed. */
  it('a receipt within the window stays', async () => {
    await receipt('yesterday', daysAgo(2));

    await expect(worker.runOnce()).resolves.toBe(0);
    await expect(prisma.webhookReceipt.count()).resolves.toBe(1);
  });

  /**
   * A thread the system has not written to for a long time no longer belongs to the registry:
   * the person's reply in it is an ordinary page change. A fresh one stays.
   */
  it('old system threads are pruned, fresh ones stay', async () => {
    const horizon = maintenanceConfig().systemDiscussionRetentionDays;

    await prisma.systemDiscussion.createMany({
      data: [
        {
          discussionId: 'silent',
          pageId: 'page-1',
          mode: 'event_evaluation',
          lastWrittenAt: daysAgo(horizon + 1),
        },
        {
          discussionId: 'recent',
          pageId: 'page-1',
          mode: 'event_evaluation',
          lastWrittenAt: daysAgo(horizon - 1),
        },
      ],
    });

    await worker.runOnce();

    const kept = await prisma.systemDiscussion.findMany();

    expect(kept.map((row) => row.discussionId)).toEqual(['recent']);
  });
});
