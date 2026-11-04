import { Prisma, ReviewOccurrence } from '../generated/prisma/client';
import { ReviewOccurrenceStatus } from '../generated/prisma/enums';
import { PrismaService } from '../platform/db/prisma.service';
import { statusIn, statusIs } from '../platform/db/sql';
import { RetirementRule } from '../platform/queue/queue.sql';
import { RunRows } from '../runs/run-row-source';
import { reviewEnvelope, TriggerEnvelope } from '../runs/trigger-envelope';
import { isReviewMode } from './review-modes';

/** Non-terminal statuses: `contracts/canonical.yaml`, key `review_occurrence`. */
const OPEN: readonly ReviewOccurrenceStatus[] = ['pending', 'running'];

const STATUS = 'ReviewOccurrenceStatus';

/**
 * There is no catching up: an occurrence that did not take place by the end of its window is
 * retired, not run later (ADR 0036). The daily window lasts to the end of the local day, the other
 * windows to the next occurrence.
 */
function afterWindow(): RetirementRule {
  return {
    when: Prisma.sql`"closes_at" <= now()`,
    reason: 'the period ended before the review was done',
  };
}

/**
 * The last carried-out occurrence of each review: the next occurrence measures its `since` from it.
 */
const LAST_DONE_PER_MODE = Prisma.sql`"id" IN (
  SELECT DISTINCT ON ("mode") "id"
    FROM "review_occurrences"
   WHERE "status" = 'done'::"ReviewOccurrenceStatus"
   ORDER BY "mode", "due_at" DESC
)`;

/**
 * Describes a review occurrence as a run queue: how its row differs from the rows of other queues
 * (ADR 0018). A review has no page and no thread, so it gets a queue of its own, not a
 * continuation (ADR 0036).
 */
export function reviewOccurrenceRows(prisma: PrismaService): RunRows<ReviewOccurrence> {
  return {
    table: 'review_occurrences',
    status: {
      open: statusIn(STATUS, OPEN),
      running: statusIs(STATUS, ReviewOccurrenceStatus.running),
      done: statusIs(STATUS, ReviewOccurrenceStatus.done),
    },
    moment: Prisma.sql`"due_at"`,
    momentOf: (occurrence) => occurrence.dueAt,
    partition: Prisma.sql`"mode"`,
    read: (ids) =>
      prisma.reviewOccurrence.findMany({ where: { id: { in: ids } }, orderBy: { dueAt: 'asc' } }),
    retireAlso: () => [afterWindow()],
    keepConcluded: LAST_DONE_PER_MODE,
    // An occurrence does not change after it is placed: neither an edit to the schedule nor a
    // repeat by the producer moves it.
    unchanged: () => Prisma.sql`TRUE`,
    supersededBecause: 'the review occurrence changed while the run was in flight',
    onSupersede: () => [],
    provenance: () => ({ origin: 'review_schedule' }),
    envelope: (occurrence) => Promise.resolve(reviewOccurrenceEnvelope(occurrence)),
  };
}

/**
 * Builds the occurrence's envelope: the review, the period key, the time and the “since the last
 * review” bound.
 */
export function reviewOccurrenceEnvelope(occurrence: ReviewOccurrence): TriggerEnvelope {
  const { mode } = occurrence;

  if (!isReviewMode(mode)) {
    throw new Error(`review occurrence ${occurrence.id}: ${mode} is not a review`);
  }

  return reviewEnvelope(mode, {
    event_id: `review:${mode}:${occurrence.occurrenceKey}`,
    timestamp: occurrence.dueAt.toISOString(),
    since: occurrence.sinceAt.toISOString(),
  });
}
