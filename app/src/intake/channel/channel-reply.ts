import { Injectable } from '@nestjs/common';
import { AttentionService } from '../../attention/attention.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { ChannelId } from '../../delivery/port/channel.port';
import { notionFailureOf } from '../../notion/semantics/notion-failure';
import { EvaluationWindowRepository } from '../notion/evaluation-window.repository';
import { ReceiptHandle } from '../receipts/webhook-receipts';
import { ChannelIntent } from './channel-intent';

/**
 * How accepting a reply ended: the words went into a thread or the reply has nothing to attach to.
 */
export type ReplyOutcome =
  | { readonly kind: 'replied' }
  | { readonly kind: 'unconsumed'; readonly reason: string }
  | { readonly kind: 'not_recorded' };

/** The event type of the window that a channel reply opens. */
export const CHANNEL_MESSAGE_EVENT = 'channel.message';

/** The channel name in the mark of the comment that transfers the person's words to Notion. */
const CHANNEL_NAMES: Readonly<Record<ChannelId, string>> = { telegram: 'Telegram' };

/**
 * The person's reply to a system message goes into Notion, and only then does the model take it
 * up.
 *
 * The channel serves a dialogue that the system starts: the person answers its messages with a
 * button or with words, and brings nothing into the channel on their own. So words are accepted
 * only as a reply to a system message that leads to a thread in Notion. The envelope does not
 * include the text (`INV-030`), the channel is not a source of state (`INV-024`), and the person
 * must see their words where their work lives. For these reasons the App itself writes the words
 * as a bot comment in that thread and then opens an evaluation window with the origin
 * `channel_inbound`. The Notion webhook for the bot's own write is filtered out by author.
 *
 * The thread's page is recorded in the receipt at once, so a redelivery that catches the work
 * unfinished finds the page and does not write a second comment.
 */
@Injectable()
export class ChannelReply {
  constructor(
    private readonly attention: AttentionService,
    private readonly delivery: DeliveryService,
    private readonly windows: EvaluationWindowRepository,
  ) {}

  async reply(
    intent: Extract<ChannelIntent, { kind: 'reply' }>,
    receipt: ReceiptHandle,
  ): Promise<ReplyOutcome> {
    const discussionId = await this.delivery.threadOf(intent.channel, intent.repliedTo);

    if (discussionId === null) {
      return {
        kind: 'unconsumed',
        reason: 'the replied message is unknown or belongs to no Notion thread',
      };
    }

    let pageId: string;

    try {
      pageId = receipt.pageId ?? (await this.quote(discussionId, intent, receipt));
    } catch (error) {
      // Notion is currently unavailable and the App does not store the text anywhere, so the
      // person is told to send it later instead of the App waiting for provider redeliveries,
      // which can run out before the outage ends (ADR 0045).
      if (notionFailureOf(error) === 'transient') return { kind: 'not_recorded' };

      throw error;
    }

    await this.windows.absorb({
      pageId,
      discussionId,
      occurredAt: intent.sentAt ?? new Date(),
      personReplied: true,
      inboxItemCreated: false,
      channelInbound: true,
      eventId: intent.eventId,
      eventType: CHANNEL_MESSAGE_EVENT,
    });

    return { kind: 'replied' };
  }

  private async quote(
    discussionId: string,
    intent: Extract<ChannelIntent, { kind: 'reply' }>,
    receipt: ReceiptHandle,
  ): Promise<string> {
    const pageId = await this.attention.quote(
      discussionId,
      CHANNEL_NAMES[intent.channel],
      intent.text,
    );

    await receipt.recordPage(pageId);

    return pageId;
  }
}
