import { Injectable, Logger } from '@nestjs/common';
import { ApprovalsService } from '../../approvals/approvals.service';
import { CHANNEL_BUTTON } from '../../runs/actor';
import { processed, ReceiptHandle, rejected, Settlement } from '../receipts/webhook-receipts';
import { ChannelIntent } from './channel-intent';
import { ChannelReply } from './channel-reply';

/**
 * What happened to the intent, without the wording of any particular channel: each adapter
 * composes the reply to the person itself.
 */
export type IntentOutcome =
  | { readonly kind: 'decided'; readonly decision: 'approve' | 'reject' }
  /** The proposal is no longer awaiting a decision: decided or gone. */
  | { readonly kind: 'not_awaiting' }
  /** The proposal expired: a review showed it, and no decision came before the next one. */
  | { readonly kind: 'expired' }
  | { readonly kind: 'dismissed' }
  /** A snooze by button: the button holds no time, so the person must name it in words. */
  | { readonly kind: 'needs_time' }
  /** The person's words went into the thread the system message belongs to, as a reply. */
  | { readonly kind: 'replied' }
  /** An intent with nothing to attach to: the channel accepts nothing new from the person. */
  | { readonly kind: 'unconsumed'; readonly reason: string }
  /**
   * The person's words could not be written to Notion, because Notion is currently unavailable.
   * The App does not store the text anywhere, so the person is told to send it later, and the
   * provider does not redeliver it (ADR 0045).
   */
  | { readonly kind: 'not_recorded' };

/**
 * The channel intent router: each intent goes to the owner of what it changes.
 *
 * The router is not part of any consumer: each intent goes to its own owner, and a consumer that
 * routed for the others would become the router of everything. Approve and reject go to
 * approvals. A snooze by button has no time, so the outcome is `needs_time`. A reply to a system
 * message goes to `ChannelReply`, which puts the person's words into the thread in Notion and
 * opens an evaluation window. Text that is not a reply is not accepted
 * (`docs/2-system.md` § “Notification channel port”). A new intent is one case, not an edit to a
 * consumer.
 *
 * The router **records** the decision and returns; the executor executes it
 * (`docs/2-system.md` § “Preconditions and executor”).
 */
@Injectable()
export class IntentRouter {
  private readonly logger = new Logger(IntentRouter.name);

  constructor(
    private readonly approvals: ApprovalsService,
    private readonly replies: ChannelReply,
  ) {}

  async route(intent: ChannelIntent, receipt: ReceiptHandle): Promise<IntentOutcome> {
    switch (intent.kind) {
      case 'approve':
      case 'reject': {
        // A button holds only the id, so nothing about the operation's content comes from here:
        // what runs is exactly what was frozen when the proposal was made.
        const decided =
          intent.kind === 'approve'
            ? await this.approvals.approve(CHANNEL_BUTTON, intent.pendingActionId)
            : await this.approvals.reject(CHANNEL_BUTTON, intent.pendingActionId);

        this.logger.log(
          `${intent.kind} ${intent.pendingActionId}: ${decided ? 'accepted' : 'no longer awaiting a decision'}`,
        );

        if (decided) return { kind: 'decided', decision: intent.kind };

        return (await this.approvals.lapsed(intent.pendingActionId))
          ? { kind: 'expired' }
          : { kind: 'not_awaiting' };
      }

      case 'dismiss':
        // The message was dismissed, not the proposal: it stays open and expires when the next
        // Daily Control comes after the one that showed it.
        return { kind: 'dismissed' };

      case 'snooze':
        // The person names the snooze time in words, not with a button, because `callback_data`
        // does not include it and `user_snooze` is accepted only from the person's words. Inventing
        // “until tomorrow” on their behalf would mean inventing a decision.
        return { kind: 'needs_time' };

      case 'reply':
        return this.replies.reply(intent, receipt);

      case 'unsolicited':
        return {
          kind: 'unconsumed',
          reason:
            'the channel carries the dialogue the system started; this text answers none of it',
        };
    }
  }
}

/**
 * Returns how the intake of an intent ended, for the receipt.
 *
 * An intent with nothing to attach to is rejected with a reason — the same rule as for
 * `page.deleted` in Notion — not a silent “processed”. The rest is processed, even when all the
 * processing is a reply to the person.
 */
export function settlementOf(outcome: IntentOutcome): Settlement<IntentOutcome> {
  switch (outcome.kind) {
    case 'unconsumed':
      return rejected(outcome.reason);

    // Rejected rather than left to the provider to redeliver, because the person has already been
    // told to send it later, and a late redelivery of the same update would produce a second reply
    // to the same words.
    case 'not_recorded':
      return rejected('Notion is unavailable: the reply was not recorded');

    default:
      return processed(outcome);
  }
}
