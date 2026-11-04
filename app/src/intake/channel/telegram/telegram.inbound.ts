import { Injectable } from '@nestjs/common';
import { actionOf } from '../../../delivery/channels/telegram/callback-data';
import type { AnswerTexts } from '../../../texts/texts';
import { ChannelInbound, ChannelIntent } from '../channel-intent';
import { IntentOutcome } from '../intent.router';
import { TelegramUpdate, telegramUpdateSchema } from './telegram-update.schema';

/**
 * The parser that reads an intent from a Telegram update.
 *
 * A button holds `kind:id` and nothing more: the format is read by the same codec that delivery
 * renders it with. Text sent as a reply to a message is a `reply`. Text with no tie to a system
 * message is `unsolicited`, because the channel accepts nothing new from the person.
 */
@Injectable()
export class TelegramInbound implements ChannelInbound {
  readonly id = 'telegram' as const;

  parse(raw: unknown): ChannelIntent | null {
    const update = telegramUpdateSchema.safeParse(raw);
    if (!update.success) {
      return null;
    }

    return this.fromCallback(update.data) ?? this.fromText(update.data);
  }

  private fromCallback(update: TelegramUpdate): ChannelIntent | null {
    const data = update.callback_query?.data;

    return data ? actionOf(data) : null;
  }

  private fromText(update: TelegramUpdate): ChannelIntent | null {
    const text = update.message?.text?.trim();
    if (!text) {
      return null;
    }

    const repliedTo = update.message?.reply_to_message?.message_id;
    if (repliedTo === undefined) {
      return { kind: 'unsolicited' };
    }

    const date = update.message?.date;

    return {
      kind: 'reply',
      repliedTo: String(repliedTo),
      text,
      channel: this.id,
      eventId: `telegram:${update.update_id}`,
      ...(date === undefined ? {} : { sentAt: new Date(date * 1000) }),
    };
  }
}

/** The answer to a press: what the person sees when the button stops spinning. */
export interface Acknowledgement {
  readonly text: string;
  /** Shown as an alert the person closes themselves, not as a pop-up line. */
  readonly alert: boolean;
}

/**
 * The answer says what happened, not what was supposed to happen. One text per kind of button
 * would lie: “executing” on a proposal that was already decided, “snoozed” on a snooze whose time
 * the button does not hold. The words come from the catalog of the installation's language
 * (`Texts.telegram.answers`). The alert the person closes themselves is for what they must read
 * in full.
 */
export function acknowledgementOf(outcome: IntentOutcome, answers: AnswerTexts): Acknowledgement {
  switch (outcome.kind) {
    case 'decided':
      return {
        text: outcome.decision === 'approve' ? answers.approved : answers.rejected,
        alert: false,
      };

    case 'not_awaiting':
      return { text: answers.notAwaiting, alert: false };

    case 'expired':
      return { text: answers.expired, alert: true };

    case 'dismissed':
      return { text: answers.dismissed, alert: false };

    // The person writes the words about the time as a reply to this message: text typed in the
    // channel goes into the thread and reaches the system the same way as in Notion.
    case 'needs_time':
      return { text: answers.needsTime, alert: true };

    // Text in the channel gets no reply: the person sees the result where their work lives, and
    // has no message to press a button on.
    case 'replied':
      return { text: answers.replied, alert: false };

    case 'unconsumed':
      return { text: answers.unconsumed, alert: false };

    case 'not_recorded':
      return { text: answers.notRecorded, alert: true };
  }
}

/**
 * Returns the answer to a press from which no intent was read: the button is not ours or is
 * stale.
 */
export function unreadable(answers: AnswerTexts): Acknowledgement {
  return { text: answers.unreadable, alert: false };
}
