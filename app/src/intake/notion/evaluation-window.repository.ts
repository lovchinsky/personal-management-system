import { Inject, Injectable } from '@nestjs/common';
import { addSeconds } from 'date-fns';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PropertyId } from '../../notion/client/property-id';
import { isUniqueViolation } from '../../platform/db/prisma-errors';
import { PrismaService } from '../../platform/db/prisma.service';
import { statusIn } from '../../platform/db/sql';
import { evaluationWindowConfig, type EvaluationWindowConfig } from './evaluation-window.config';
import { OPEN, STATUS } from './evaluation-window.rows';

/**
 * The shape of what the merge returns. It is parsed with a schema instead of being cast to a type:
 * what `$queryRaw` returns is `unknown`, and a claim about its shape would be a promise with no
 * check. Only the `id` is returned, because there is no one to hand the full row to.
 */
const mergedRow = z.array(z.object({ id: z.string() }));

interface WindowEvent {
  readonly pageId: string;
  /** The time of the event itself, as the provider reports it. */
  readonly occurredAt: Date;
  readonly discussionId?: string;
  /** The person replied in a thread the system manages: the window's run is their reply. */
  readonly personReplied: boolean;
  /** The person put this page in the Inbox: the window's run is the processing of the item. */
  readonly inboxItemCreated: boolean;
  /** The person wrote in the channel: the window's run is their message, already in Notion. */
  readonly channelInbound: boolean;
  readonly eventId: string;
  readonly eventType: string;
  /** Canonical: the translation happens on the way in, in the event schema. */
  readonly updatedProperties?: readonly PropertyId[];
}

/**
 * A debounce window over the events of one page, seen from the producer's side: events are
 * absorbed into the window. The run source (`EvaluationWindowRunSource`) manages the window's run.
 *
 * Absorption is per page, not per logical change, because a person makes several edits in a row,
 * and a run per edit would be several runs about one thought.
 */
@Injectable()
export class EvaluationWindowRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(evaluationWindowConfig.KEY) private readonly config: EvaluationWindowConfig,
  ) {}

  /**
   * Checks whether the page has an open window, which means an evaluation is already waiting for
   * the page's change.
   */
  async hasOpenOn(pageId: string): Promise<boolean> {
    const open = await this.prisma.evaluationWindow.count({
      where: { pageId, status: { in: [...OPEN] } },
    });

    return open > 0;
  }

  /**
   * Opens a window or folds the event into the existing one. Returns the window's id.
   *
   * The merge comes first; creation follows only if the merge fails. The reverse order (“find, then
   * write”) would read the state in one statement and decide in the next: two events of the same
   * page that arrived at the same time would see the same snapshot, and the second would
   * overwrite the first. A race on creation stays possible. It ends in `P2002`, because the
   * partial index does not let a second open window appear, and the merge is then repeated against
   * the winning row.
   */
  async absorb(event: WindowEvent): Promise<string> {
    const merged = await this.mergeInto(event);
    if (merged) {
      return merged;
    }

    try {
      const created = await this.prisma.evaluationWindow.create({
        data: {
          pageId: event.pageId,
          discussionId: event.discussionId ?? null,
          personReplied: event.personReplied,
          inboxItemCreated: event.inboxItemCreated,
          channelInbound: event.channelInbound,
          updatedProperties: [...(event.updatedProperties ?? [])],
          eventTypes: [event.eventType],
          latestEventId: event.eventId,
          latestEventType: event.eventType,
          latestEventAt: event.occurredAt,
          notBefore: addSeconds(new Date(), this.config.debounceSeconds),
        },
      });

      return created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const raced = await this.mergeInto(event);
      if (!raced) {
        throw error;
      }

      return raced;
    }
  }

  /**
   * Folds the event into the page's open window in one statement.
   *
   * Postgres itself computes the union of the lists. Computed in JS over a snapshot, it would lose
   * the properties of one of two deliveries that coincided: only what you read and write together
   * can be guarded.
   *
   * `GREATEST` is applied to the event time because the provider redelivers up to eight times
   * within a day, so a late copy of an old event is routine. Without `GREATEST` the copy would
   * overwrite the stored event time with an **older** value, and the time in the envelope
   * (`INV-030`) would run backwards.
   *
   * `status` is in the predicate because the row may have closed between the read and the write,
   * and a write to a terminal window achieves nothing: the window will never be claimed. In that
   * case no merge happens, and the caller opens a new window.
   */
  private async mergeInto(event: WindowEvent): Promise<string | null> {
    const properties: readonly string[] = event.updatedProperties ?? [];
    const personSpoke = event.personReplied || event.inboxItemCreated || event.channelInbound;
    const debounce = this.config.debounceSeconds;
    const ceiling = this.config.maxWindowSeconds;

    const rows: unknown = await this.prisma.$queryRaw(Prisma.sql`
      UPDATE "evaluation_windows"
         SET "updated_properties" = ARRAY(
               SELECT DISTINCT unnest("updated_properties" || ${properties}::text[]) ORDER BY 1
             ),
             "event_types" = ARRAY(
               SELECT DISTINCT unnest("event_types" || ${[event.eventType]}::text[]) ORDER BY 1
             ),
             "discussion_id" = COALESCE(${event.discussionId ?? null}::text, "discussion_id"),
             -- The person's reply is not canceled by a later edit of the page.
             "person_replied" = "person_replied" OR ${event.personReplied},
             "inbox_item_created" = "inbox_item_created" OR ${event.inboxItemCreated},
             "channel_inbound" = "channel_inbound" OR ${event.channelInbound},
             "latest_event_id" = CASE
               WHEN ${event.occurredAt} >= "latest_event_at" THEN ${event.eventId}
               ELSE "latest_event_id" END,
             "latest_event_type" = CASE
               WHEN ${event.occurredAt} >= "latest_event_at" THEN ${event.eventType}
               ELSE "latest_event_type" END,
             "latest_event_at" = GREATEST("latest_event_at", ${event.occurredAt}),
             -- The ceiling is measured from creation: otherwise continuous editing would keep the
             -- window open indefinitely. The window is never pulled earlier, so an event
             -- does not make a postponed row due immediately.
             "not_before" = GREATEST(
               "not_before",
               LEAST(
                 now() + make_interval(secs => ${debounce}::double precision),
                 "created_at" + make_interval(secs => ${ceiling}::double precision)
               )
             ),
             -- An event from the person releases the Notion hold, so their words are tried at
             -- once, not after the pause the window had been waiting out until then (ADR 0045).
             "notion_hold_until" = CASE WHEN ${personSpoke} THEN NULL ELSE "notion_hold_until" END,
             "notion_held_since" = CASE WHEN ${personSpoke} THEN NULL ELSE "notion_held_since" END,
             "version" = "version" + 1,
             "updated_at" = now()
       WHERE "page_id" = ${event.pageId}
         AND ${statusIn(STATUS, OPEN)}
      RETURNING "id"
    `);

    const [merged] = mergedRow.parse(rows);

    return merged?.id ?? null;
  }
}
