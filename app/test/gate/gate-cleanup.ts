import { INestApplicationContext } from '@nestjs/common';
import { runnerConfig, type RunnerConfig } from '../../src/claude/runner/runner.config';
import { GbrainToken } from '../../src/credentials/gbrain/gbrain.token';
import { Prisma } from '../../src/generated/prisma/client';
import { GbrainClient, type GbrainPort } from '../../src/memory/gbrain-client';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { PageReader } from '../../src/notion/client/page.reader';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { messageOf } from '../../src/platform/error/message-of';

/**
 * The register of what a gate scenario created and the gate must clean up: whatever the gate
 * launched or created, it records.
 */
export interface Residue {
  /** Notion pages: created by the scenario's world and created by runs. */
  readonly pages: string[];
  /** Delivery keys: of the system message placed by the gate, and of the deliveries of runs. */
  readonly outboxKeys: string[];
  /** Threads opened by the gate or by the system during a run. */
  readonly threads: string[];
  /** The gate's runs, which leave proposals behind. */
  readonly runs: string[];
  /** The slugs of pages the gate wrote to GBrain. */
  readonly gbrainPages: string[];
  /**
   * The queue rows that runs scheduled, by id from their effects. A continuation on a foreign page
   * and with no thread cannot be found by page or by thread, and a thread that was already in
   * normal operation cannot be added to `threads`, because cleaning up by thread would delete the
   * main rows too.
   */
  readonly continuations: string[];
  readonly deliveries: string[];
  readonly proposals: string[];
  /**
   * The occurrences of reviews that the gate scheduled. Otherwise the period key would stay taken
   * for the next attempt.
   */
  readonly occurrences: string[];
}

export function emptyResidue(): Residue {
  return {
    pages: [],
    outboxKeys: [],
    threads: [],
    runs: [],
    gbrainPages: [],
    continuations: [],
    deliveries: [],
    proposals: [],
    occurrences: [],
  };
}

/**
 * What the gate cannot clean up by construction: the verdict names it next to the residue, so that
 * “cleaned up” is not read as “nothing is left”.
 */
export const UNMANAGED: readonly string[] = [
  'run traces of the gate runs (kept for diagnosis)',
  'GBrain records written by the runs',
  'webhook receipts of the simulated channel updates (update ids above the real range)',
];

/** What the verdict says about cleanup: whether it is clean, what is left, what is unmanaged. */
interface CleanupVerdict {
  readonly clean: boolean;
  readonly left: readonly string[];
  readonly unmanaged: readonly string[];
}

export function cleanupVerdict(
  left: readonly string[],
  unmanaged: readonly string[] = UNMANAGED,
): CleanupVerdict {
  return { clean: left.length === 0, left, unmanaged };
}

/** A table the gate removes rows from: the condition is typed by the Prisma model. */
interface Deleting<Where> {
  deleteMany(args: { where: Where }): Promise<unknown>;
}

/** What cleanup needs in `app_db` and in Notion. */
interface CleanupPorts {
  readonly outbox: Deleting<Prisma.NotificationOutboxWhereInput>;
  readonly continuations: Deleting<Prisma.ScheduledCheckWhereInput>;
  readonly windows: Deleting<Prisma.EvaluationWindowWhereInput>;
  readonly proposals: Deleting<Prisma.PendingActionWhereInput>;
  readonly occurrences: Deleting<Prisma.ReviewOccurrenceWhereInput>;
  readonly discussions: Deleting<Prisma.SystemDiscussionWhereInput>;
  readonly sweepMarks: Deleting<Prisma.SweepMarkWhereInput>;
  readonly reconciliations: Deleting<Prisma.DiscussionReconciliationWhereInput>;
  readonly inTrash: (pageId: string) => Promise<boolean>;
  readonly trash: (pageId: string) => Promise<unknown>;
  readonly gbrain: Pick<GbrainPort, 'deletePage'>;
}

type Step = readonly [name: string, run: () => Promise<unknown>];

/**
 * Returns each id in both spellings: hyphenated, as Notion returns it, and canonical, as `app_db`
 * has it.
 */
function spelledBoth(ids: readonly string[]): string[] {
  return [...new Set(ids.flatMap((id) => [id, canonicalNotionId(id)]))];
}

/** Returns which of these pages the gate did not create. It has no right to touch them. */
export function pagesOutside(residue: Residue, pageIds: readonly string[]): string[] {
  const own = new Set(spelledBoth(residue.pages));

  return pageIds.filter((id) => !own.has(id) && !own.has(canonicalNotionId(id)));
}

/**
 * Cleans up after the gate. The steps are independent: a failure of one does not stop the rest and
 * stays in the list of residue. First come the rows the next gate attempt would take for its own
 * (deliveries, evaluation windows, continuations, proposals), then Notion, and last the hygiene
 * and the GBrain pages, because the network is the most fragile part, and its failure must not
 * leave a row in the queue that the next attempt would take.
 */
export class GateCleanup {
  constructor(private readonly ports: CleanupPorts) {}

  static of(app: INestApplicationContext): GateCleanup {
    const prisma = app.get(PrismaService);
    const pages = app.get(PageReader);
    const writer = app.get(NotionWriter);

    return new GateCleanup({
      outbox: prisma.notificationOutbox,
      continuations: prisma.scheduledCheck,
      windows: prisma.evaluationWindow,
      proposals: prisma.pendingAction,
      occurrences: prisma.reviewOccurrence,
      discussions: prisma.systemDiscussion,
      sweepMarks: prisma.sweepMark,
      reconciliations: prisma.discussionReconciliation,
      inTrash: async (pageId) => (await pages.page(pageId)).inTrash,
      trash: (pageId) => writer.archive(pageId),
      gbrain: GbrainClient.of(app.get(GbrainToken), app.get<RunnerConfig>(runnerConfig.KEY)),
    });
  }

  /**
   * Returns the residue list, items `"<step>: <reason>"`; empty when all is cleaned up. Does not
   * throw.
   */
  async clean(residue: Residue): Promise<string[]> {
    const left: string[] = [];

    for (const [name, run] of this.steps(residue)) {
      try {
        await run();
      } catch (error) {
        left.push(`${name}: ${messageOf(error)}`);
      }
    }

    return left;
  }

  private steps(residue: Residue): Step[] {
    const ports = this.ports;
    const pages = spelledBoth(residue.pages);
    const threads = spelledBoth(residue.threads);

    return [
      [
        'outbox',
        () =>
          ports.outbox.deleteMany({
            where: {
              OR: [
                { idempotencyKey: { in: residue.outboxKeys } },
                { discussionId: { in: threads } },
                { id: { in: residue.deliveries } },
              ],
            },
          }),
      ],
      [
        'continuations',
        () =>
          ports.continuations.deleteMany({
            where: {
              OR: [
                { discussionId: { in: threads } },
                { notionPageId: { in: pages } },
                { id: { in: residue.continuations } },
              ],
            },
          }),
      ],
      [
        'windows',
        () =>
          ports.windows.deleteMany({
            where: { OR: [{ pageId: { in: pages } }, { discussionId: { in: threads } }] },
          }),
      ],
      [
        'proposals',
        () =>
          ports.proposals.deleteMany({
            where: {
              OR: [
                { proposedByRunId: { in: residue.runs } },
                { discussionId: { in: threads } },
                { id: { in: residue.proposals } },
              ],
            },
          }),
      ],
      [
        'occurrences',
        () => ports.occurrences.deleteMany({ where: { id: { in: residue.occurrences } } }),
      ],
      ...residue.pages.map((id): Step => [`page ${id}`, () => this.trash(id)]),
      [
        'discussions',
        () =>
          ports.discussions.deleteMany({
            where: { OR: [{ discussionId: { in: threads } }, { pageId: { in: pages } }] },
          }),
      ],
      // The sweep and reconciliation memory of the attempt's pages and threads: otherwise the next
      // attempt would find foreign marks, and the daily limit of wakes would count the wakes of the
      // cleaned-up world.
      ['sweep marks', () => ports.sweepMarks.deleteMany({ where: { pageId: { in: pages } } })],
      [
        'reconciliations',
        () => ports.reconciliations.deleteMany({ where: { discussionId: { in: threads } } }),
      ],
      // GBrain pages go last, because the network is the most fragile part. The register is
      // emptied at once, so a second cleanup of the same page will not delete it again.
      ...residue.gbrainPages
        .splice(0)
        .map((slug): Step => [`gbrain ${slug}`, () => ports.gbrain.deletePage(slug)]),
    ];
  }

  /**
   * Moves a page to the trash; a network failure is retried once, because here one failure leaves
   * the page in the workspace.
   */
  private async trash(pageId: string): Promise<void> {
    const attempt = async (): Promise<void> => {
      if (!(await this.ports.inTrash(pageId))) {
        await this.ports.trash(pageId);
      }
    };

    try {
      await attempt();
    } catch {
      await attempt();
    }
  }
}
