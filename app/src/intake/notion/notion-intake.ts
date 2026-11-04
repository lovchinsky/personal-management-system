import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '../../approvals/approvals.service';
import { AttentionService } from '../../attention/attention.service';
import { PageReader } from '../../notion/client/page.reader';
import { notionFailureOf } from '../../notion/semantics/notion-failure';
import { SemanticAdapter } from '../../notion/semantics/semantic.adapter';
import { processed, rejected, Settlement, WebhookReceipts } from '../receipts/webhook-receipts';
import { NotionAuthorship } from './authorship';
import { EvaluationWindowRepository } from './evaluation-window.repository';
import { NotionEvent, pageOf } from './notion-event.schema';
import { RelevanceGate } from './relevance.gate';

const PAGE_CREATED = 'page.created';
const PAGE_CONTENT_UPDATED = 'page.content_updated';

/**
 * Types whose body edits are worth evaluating, because the person writes promises and dependencies
 * in the body of a Task and a Project. The bodies of the other types are prose, which reviews read
 * (ADR 0040).
 */
const BODY_WATCHED: ReadonlySet<string> = new Set(['task', 'project']);
const COMMENT_CREATED = 'comment.created';
const COMMENT_UPDATED = 'comment.updated';

/** Events through which the person speaks in a thread: a new reply or an edit to one. */
const COMMENT_EVENTS: ReadonlySet<string> = new Set([COMMENT_CREATED, COMMENT_UPDATED]);

/**
 * Changes the person makes to the page's properties and to the page itself, after which a
 * proposal on the page may no longer make sense. A proposal's preconditions look only at these
 * changes (ADR 0044).
 */
const PAGE_STATE_EVENTS: ReadonlySet<string> = new Set(['page.properties_updated', 'page.deleted']);

export type IntakeOutcome =
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'absorbed'; readonly windowId: string };

/**
 * The path of a Notion event from the wire to the evaluation window.
 *
 * The order of the steps is normative: signature check (guard), idempotency, author, relevance
 * gate, debounce. The run budget is deliberately not consulted here, because at this step there is
 * nothing to launch yet. A run starts when the window comes due, and consulting the limit earlier
 * would mean consulting it about a run that may never happen.
 */
@Injectable()
export class NotionIntake {
  constructor(
    private readonly receipts: WebhookReceipts,
    private readonly authorship: NotionAuthorship,
    private readonly gate: RelevanceGate,
    private readonly windows: EvaluationWindowRepository,
    private readonly attention: AttentionService,
    private readonly semantics: SemanticAdapter,
    private readonly pages: PageReader,
    private readonly approvals: ApprovalsService,
  ) {}

  async accept(event: NotionEvent): Promise<IntakeOutcome> {
    const pageId = pageOf(event);

    const settled = await this.receipts.receive(
      {
        source: 'notion',
        externalId: event.id,
        eventType: event.type,
        entityId: event.entity.id,
        pageId,
        attemptNumber: event.attempt_number,
        diagnostics: {
          authors: event.authors,
          subscription_id: event.subscription_id,
          updated_properties: event.data.updated_properties,
          discussion_id: event.data.discussion_id,
          parent: event.data.parent,
        },
      },
      () => this.process(event, pageId),
    );

    if (!settled) {
      return { kind: 'duplicate' };
    }

    return settled.status === 'rejected'
      ? { kind: 'rejected', reason: settled.reason }
      : { kind: 'absorbed', windowId: settled.value };
  }

  private async process(
    event: NotionEvent,
    pageId: string | undefined,
  ): Promise<Settlement<string>> {
    // The system's own write does not wake a run, because the system already knows everything
    // about it.
    if ((await this.authorship.of(event)) === 'system') {
      return rejected('own write of the system: every author is the integration bot');
    }

    if (!pageId) {
      return rejected(`event ${event.type} names no page`);
    }

    // The person may have acted ahead of a proposal waiting on this page, so the executor checks
    // the proposal's preconditions regardless of whether the change is worth an evaluation
    // (ADR 0044).
    if (PAGE_STATE_EVENTS.has(event.type)) {
      await this.approvals.recheckOn(pageId);
    }

    const relevance = await this.relevanceOf(event, pageId);
    if (!relevance.relevant) {
      return rejected(relevance.reason);
    }

    const { discussionId } = event.data;
    const windowId = await this.windows.absorb({
      pageId,
      discussionId,
      personReplied: await this.repliesToSystem(event.type, discussionId),
      inboxItemCreated: this.putInInbox(event),
      channelInbound: false,
      eventId: event.id,
      eventType: event.type,
      occurredAt: new Date(event.timestamp),
      updatedProperties: event.data.changedPropertyIds,
    });

    return processed(windowId);
  }

  /**
   * Checks whether the person is replying to the system: a comment in a thread the system manages
   * (`INV-089`). The author has already been checked, so the system's own comment does not get
   * here.
   */
  private async repliesToSystem(type: string, discussionId: string | undefined): Promise<boolean> {
    if (discussionId === undefined || !COMMENT_EVENTS.has(type)) return false;

    return (await this.attention.managed(discussionId)) !== null;
  }

  /**
   * Checks whether the person put an item in the Inbox: the page is created in the database that
   * the binding names as the Inbox database. The author has already been checked, so the system's
   * own item does not get here.
   */
  private putInInbox(event: NotionEvent): boolean {
    const dataSourceId = event.data.parent?.data_source_id;

    return (
      event.type === PAGE_CREATED &&
      dataSourceId !== undefined &&
      this.semantics.typeOfDataSource(dataSourceId) === 'inbox_item'
    );
  }

  /**
   * Checks whether the body of this page is worth evaluating: the page is in the Tasks or Projects
   * database. The event names the database (`data.parent`). When it does not, the page is read.
   * A page that does not exist or that is not shared with the integration is rejected with a
   * reason, because a redelivery will not bring it back. A transient failure is thrown, and Notion
   * redelivers.
   */
  private async bodyRelevance(
    event: NotionEvent,
    pageId: string,
  ): Promise<{ relevant: true } | { relevant: false; reason: string }> {
    let dataSourceId = event.data.parent?.data_source_id ?? null;

    if (dataSourceId === null) {
      try {
        dataSourceId = (await this.pages.page(pageId)).dataSourceId;
      } catch (error) {
        switch (notionFailureOf(error)) {
          case 'absent':
            return { relevant: false, reason: 'page.content_updated of a page that is gone' };

          case 'no_access':
            return {
              relevant: false,
              reason: 'page.content_updated of a page the integration cannot read',
            };

          case 'transient':
          case 'misconfigured':
          case 'unknown':
            throw error;
        }
      }
    }

    const type = dataSourceId === null ? undefined : this.semantics.typeOfDataSource(dataSourceId);

    return type !== undefined && BODY_WATCHED.has(type)
      ? { relevant: true }
      : {
          relevant: false,
          reason: 'page.content_updated outside the Task and Project data sources',
        };
  }

  /**
   * Decides relevance by the **event type**, and only then by the intersection.
   *
   * The rule `updated_properties ∩ watched` applies only where there is a list at all.
   * `page.created` never has one, under any name, so applying the rule literally would reject
   * every creation (`docs/2-system.md` § “Webhook intake”).
   */
  private async relevanceOf(
    event: NotionEvent,
    pageId: string,
  ): Promise<{ relevant: true } | { relevant: false; reason: string }> {
    switch (event.type) {
      // A creation in the Inbox is relevant by construction, because the event has no property
      // list and the very fact that an item appeared is the cause.
      case PAGE_CREATED:
        return { relevant: true };

      // A new reply from the person has high priority, because it may contain clarification,
      // dismiss, snooze, approval or information about resolution.
      case COMMENT_CREATED:
      case COMMENT_UPDATED:
        return { relevant: true };

      // A body edit has no property list, so the page type decides relevance.
      case PAGE_CONTENT_UPDATED:
        return this.bodyRelevance(event, pageId);

      // The observable counterpart of moving a page to the trash has no consumer, so the event is
      // recorded as rejected, with a reason and not in silence.
      case 'page.deleted':
        return { relevant: false, reason: 'page.deleted has no consumer yet' };

      default: {
        if (event.data.updated_properties === undefined) {
          return { relevant: false, reason: `event ${event.type} carries no property list` };
        }

        return this.gate.matches(event.data.changedPropertyIds)
          ? { relevant: true }
          : { relevant: false, reason: 'no watched property changed' };
      }
    }
  }
}
