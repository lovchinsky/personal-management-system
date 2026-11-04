import { AttentionService } from '../../attention/attention.service';
import { EvaluationWindow, Prisma } from '../../generated/prisma/client';
import { EvaluationWindowStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../platform/db/prisma.service';
import { olderThanDays, statusIn, statusIs } from '../../platform/db/sql';
import { RetirementRule } from '../../platform/queue/queue.sql';
import { ScheduledProvenance } from '../../runs/provenance';
import { RunRows } from '../../runs/run-row-source';
import { eventEnvelope, EventMode, TriggerEnvelope } from '../../runs/trigger-envelope';
import { type EvaluationWindowConfig } from './evaluation-window.config';

/** Non-terminal statuses: `contracts/canonical.yaml`, key `evaluation_window`. */
export const OPEN: readonly EvaluationWindowStatus[] = ['pending', 'running'];

export const STATUS = 'EvaluationWindowStatus';

/**
 * A window that has received nothing for a long time is no longer news; its age is measured from
 * the last event (`contracts/canonical.yaml`, key `evaluation_window`).
 */
function afterStaleness(config: EvaluationWindowConfig): RetirementRule {
  const days = config.maxAgeDays;

  return {
    when: olderThanDays('latest_event_at', days),
    reason: `no new event for ${days}d`,
  };
}

/**
 * Determines a window's origin: the person's words in the channel rank above a reply in a thread,
 * a reply in a thread above a new Inbox item, and a new Inbox item above a change.
 */
function provenanceOf(window: EvaluationWindow): ScheduledProvenance {
  if (window.channelInbound) return { origin: 'channel_inbound' };
  if (window.personReplied) return { origin: 'managed_discussion_reply' };
  if (window.inboxItemCreated) return { origin: 'inbox_capture' };
  return { origin: 'evaluation_window' };
}

/**
 * A person's reply continues in the thread's mode
 * (`contracts/canonical.yaml`, key `system_discussion`). The other windows evaluate changes. A
 * thread the system no longer manages still counts as a reply — the person has had their say —
 * but is evaluated as a change.
 */
async function modeOf(
  window: EvaluationWindow,
  attention: Pick<AttentionService, 'managed'>,
): Promise<EventMode> {
  // Processing an Inbox item is a dialogue: only there can an item become a Task.
  if (window.inboxItemCreated) return 'dialogue';
  if (!window.personReplied || window.discussionId === null) return 'event_evaluation';
  return (await attention.managed(window.discussionId)) ?? 'event_evaluation';
}

function envelopeOf(window: EvaluationWindow, mode: EventMode): TriggerEnvelope {
  return eventEnvelope(mode, {
    // The type of the event that closed the window comes from its own column, not from the last
    // element of `event_types`: the set is sorted, so its last element is not the type that came
    // last. The column is paired with `latest_event_id` and `latest_event_at` for the same reason.
    type: window.latestEventType,
    event_types: window.eventTypes,
    event_id: window.latestEventId,
    // The time of the event itself, not the time the row was written: the envelope declares that
    // one, and the values of an `app_db` column do not go into the prompt (`INV-030`).
    timestamp: window.latestEventAt.toISOString(),
    entity_id: window.pageId,
    page_id: window.pageId,
    ...(window.discussionId === null ? {} : { discussion_id: window.discussionId }),
    updated_property_ids: window.updatedProperties,
  });
}

/**
 * Describes the change evaluation window as a run queue: how its row differs from the rows of the
 * other queues (ADR 0018).
 *
 * A window in which the person replied in a system thread is their reply, not an autonomous
 * evaluation. It has a different origin and a different run priority class, and it does not spend
 * budget (`INV-089`). A window of an item the person put in the Inbox is the processing of that
 * item. It has its own origin and its own class. A window that a channel message opened has the
 * origin `channel_inbound`: the person's text already lives in Notion, and the envelope keeps only
 * the origin.
 */
export function evaluationWindowRows(
  prisma: PrismaService,
  config: EvaluationWindowConfig,
  attention: Pick<AttentionService, 'managed'>,
): RunRows<EvaluationWindow> {
  return {
    table: 'evaluation_windows',
    status: {
      open: statusIn(STATUS, OPEN),
      running: statusIs(STATUS, EvaluationWindowStatus.running),
      done: statusIs(STATUS, EvaluationWindowStatus.done),
    },
    moment: Prisma.sql`"not_before"`,
    momentOf: (window) => window.notBefore,
    // A window's origin is derived from its facts: the person's words in the channel, a person's
    // reply, an Inbox item. So the selection is partitioned by them too. Otherwise an older
    // window of an autonomous change would hide the person's fresh reply from the scheduler.
    partition: Prisma.sql`"channel_inbound", "person_replied", "inbox_item_created"`,
    read: (ids) =>
      prisma.evaluationWindow.findMany({
        where: { id: { in: ids } },
        orderBy: { notBefore: 'asc' },
      }),
    retireAlso: () => [afterStaleness(config)],
    // Unchanged means the same window at the same version
    // (`docs/2-system.md` § “`evaluation_windows`”).
    unchanged: (window) => Prisma.sql`"version" = ${window.version}`,
    supersededBecause: 'window changed while the run was in flight',
    // A window that had an event absorbed comes due again after a new stretch of silence, not at
    // once: otherwise it would go to a second run while the person is still typing. The time is
    // not pulled earlier than the one already assigned: `GREATEST` keeps the later one.
    onSupersede: () => [
      Prisma.sql`"not_before" = GREATEST("not_before", now() + make_interval(secs => ${config.debounceSeconds}::double precision))`,
    ],
    provenance: provenanceOf,
    envelope: async (window) => envelopeOf(window, await modeOf(window, attention)),
  };
}
