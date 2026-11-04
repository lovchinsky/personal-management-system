import { Inject, Injectable, Logger } from '@nestjs/common';
import { appConfig, type AppConfig } from '../../config/app.config';
import { PendingAction } from '../../generated/prisma/client';
import { LiveSchema } from '../../notion/client/live-schema';
import { NotionWriter } from '../../notion/client/notion.writer';
import { PageReader } from '../../notion/client/page.reader';
import { notionFailureOf } from '../../notion/semantics/notion-failure';
import { SemanticAdapter, ShownValue } from '../../notion/semantics/semantic.adapter';
import { messageOf } from '../../platform/error/message-of';
import { spokenDateValue } from '../../texts/spoken-dates';
import {
  isSpokenField,
  textsOf,
  type CommentTexts,
  type NotWrittenReason,
} from '../../texts/texts';
import { PendingActionRepository } from '../contracts/pending-action.repository';
import { PROPOSAL_NOTICE, type ProposalNotice } from '../proposal-notice';
import { effectsSchema } from '../proposal.schema';
import { writesOf } from '../proposal.validity';

/**
 * The proposal's trail in the thread: the person's decision or the non-execution of what was
 * approved.
 */
type Trace = 'approved' | 'rejected' | 'notWritten';

/** How many characters of an effect's text the trail quotes verbatim. */
const SHOWN_TEXT_CHARS = 80;

/**
 * Publishes a proposal's fate as a trail in its thread and a message in the channel (ADR 0043,
 * `INV-107`).
 *
 * The fate becomes an event in the thread because the thread is the canonical history of the
 * interaction: the next run reads it, and the person and the chat see it in Notion. The trail
 * records the person's decision — approval or rejection — and the non-execution of what was
 * approved. It does not record execution or expiry: an executed change is visible on its own, and
 * an expiry is not an event. The system writes the trail with a catalog text and under a kind
 * label. The change is worded with the workspace names from the proposal's contract, not with the
 * model's own text.
 *
 * Each transition is published once: the row remembers the published fate, and the decision's
 * trail is marked right after the write, so a retry after a failure does not write the trail a
 * second time. A thread that can no longer be written to (the page is gone, there is no access,
 * Notion does not accept the comment) is left without a trail, and the proposal's fate stays
 * published: otherwise the row would be retried endlessly.
 */
@Injectable()
export class ProposalPublisher {
  private readonly logger = new Logger(ProposalPublisher.name);

  constructor(
    private readonly actions: PendingActionRepository,
    private readonly pages: PageReader,
    private readonly schema: LiveSchema,
    private readonly semantics: SemanticAdapter,
    private readonly writer: NotionWriter,
    @Inject(PROPOSAL_NOTICE) private readonly notice: ProposalNotice,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async publish(action: PendingAction): Promise<void> {
    const { status } = action;
    let published = action.publishedStatus;

    if (status === 'proposed' || status === published) return;

    // An approval keeps its time, so even a row that has already ended still shows that the person
    // approved.
    const decided = action.approvedAt !== null;

    if (published === null && (status === 'rejected' || decided)) {
      const decision = status === 'rejected' ? 'rejected' : 'approved';

      await this.trace(action, decision);
      await this.actions.published(action.id, null, decision);
      published = decision;
    }

    if ((status === 'conflict' || status === 'failed') && decided) {
      await this.trace(action, 'notWritten');
    }

    await this.notice.settled(action.id, status);
    await this.actions.published(action.id, published, status);
  }

  /**
   * Writes the trail in the proposal's thread. A proposal without a thread has no trail, only the
   * message.
   */
  private async trace(action: PendingAction, trace: Trace): Promise<void> {
    if (action.discussionId === null) return;

    const texts = textsOf(this.app.language).comments;

    try {
      const change = await this.changeOf(action, texts);
      const { proposal, labels } = texts;
      const [text, label] =
        trace === 'approved'
          ? [proposal.approved(change, this.app.ownerGender), labels.proposalDecision]
          : trace === 'rejected'
            ? [proposal.rejected(change, this.app.ownerGender), labels.proposalDecision]
            : [
                proposal.notWritten(change, proposal.reasons[reasonOf(action)]),
                labels.proposalResult,
              ];

      await this.writer.comment({ discussionId: action.discussionId }, text, { label });
    } catch (error) {
      if (!this.unwritable(error)) throw error;

      this.logger.warn(`trace of ${action.id} not written: ${messageOf(error)}`);
    }
  }

  /**
   * Returns the change of a proposal in the person's words: “status → Next Action”, “deadline →
   * November 10”. A field that the catalog has a word for in the installation's language gets that
   * word; the rest get the workspace name. An option value is shown as the workspace shows it,
   * because that is what the person chose (ADR 0046).
   */
  private async changeOf(action: PendingAction, texts: CommentTexts): Promise<string> {
    const effects = effectsSchema.parse(action.effects);
    const page = await this.pages.page(action.notionPageId);
    const live = page.dataSourceId === null ? new Map() : await this.schema.of(page.dataSourceId);
    const now = new Date();
    const date = (start: string, end: string | null): string =>
      spokenDateValue(start, end, this.app.language, this.app.timeZone, now);

    return this.semantics
      .shownOn(page, live, writesOf(effects))
      .map(({ field, canonical, value }) => {
        const named = isSpokenField(canonical) ? texts.fields[canonical] : field;

        return `${named} → ${shown(value, texts, date)}`;
      })
      .join('; ');
  }

  /**
   * Checks whether the trail cannot be written at all: the page is gone, there is no access, or
   * Notion does not accept the comment. A temporary failure is not one of these cases, so the trail
   * waits for the next tick.
   */
  private unwritable(error: unknown): boolean {
    switch (notionFailureOf(error)) {
      case 'absent':
      case 'no_access':
      case 'misconfigured':
        return true;

      case 'transient':
      case 'unknown':
        return false;
    }
  }
}

/**
 * Renders a change value in the catalog's words. The date is put into words using the installation
 * language's format.
 */
function shown(
  value: ShownValue,
  texts: CommentTexts,
  date: (start: string, end: string | null) => string,
): string {
  switch (value.kind) {
    case 'option':
      return value.name;

    case 'date':
      return date(value.start, value.end);

    case 'text':
      return value.text.length > SHOWN_TEXT_CHARS
        ? `«${value.text.slice(0, SHOWN_TEXT_CHARS)}…»`
        : `«${value.text}»`;

    case 'links':
      return texts.proposal.links(value.count);

    case 'clear':
      return texts.proposal.cleared;
  }
}

/**
 * Returns why the approved change was not written, in the words the trail uses to tell the person.
 */
function reasonOf(action: PendingAction): NotWrittenReason {
  if (action.status === 'conflict') return 'conflict';

  switch (action.failure) {
    case 'no_access':
      return 'noAccess';

    case 'unavailable':
      return 'unavailable';

    default:
      return 'other';
  }
}
