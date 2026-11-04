import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { required } from '../platform/config/env-value';
import { messageOf } from '../platform/error/message-of';
import { telegramConfig, type TelegramConfig } from './telegram.config';

const response = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

/**
 * The message the Bot API returned. Only its id is taken. Even without it the message has already
 * been sent, so a missing id does not make the delivery fail, but only deprives the person of a
 * way to reply to the message and the system of a way to edit it.
 */
const sentMessage = z.object({ message_id: z.number() });

/** The Bot API's response: a refusal always has a reason, a pause only if Telegram names one. */
export type TelegramCallResult =
  | {
      readonly ok: true;
      /** The id of the sent message, only in the response to `sendMessage`. */
      readonly messageId?: string;
    }
  | { readonly ok: false; readonly error: string; readonly retryAfterSeconds?: number };

/**
 * How long to wait for the Bot API.
 *
 * Without a limit, a hung call would keep the webhook response open — about five minutes by
 * default in undici. Meanwhile Telegram would redeliver the update, and the same work would run a
 * second time in parallel with the first. A normal response arrives within a fraction of a
 * second, so ten seconds marks a failure, not slowness.
 */
const CALL_TIMEOUT_MS = 10_000;

export interface InlineButton {
  readonly text: string;
  readonly callback_data: string;
}

/**
 * A client for the Bot API with exactly the calls that are needed: `sendMessage`,
 * `editMessageText` and `answerCallbackQuery`.
 *
 * A provider error is returned as a value, not thrown, because a `429` with `retry_after` is not a
 * delivery failure but an instruction on when sending is possible. The queue must read the
 * instruction instead of swallowing it along with the stack trace.
 */
@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);

  constructor(@Inject(telegramConfig.KEY) private readonly config: TelegramConfig) {}

  /** Sends a message; `keyboard` holds the rows of buttons under it. */
  sendMessage(
    chatId: string,
    html: string,
    keyboard: readonly (readonly InlineButton[])[] = [],
  ): Promise<TelegramCallResult> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard.length > 0 ? { reply_markup: { inline_keyboard: markup(keyboard) } } : {}),
    });
  }

  /**
   * Rewrites the sent message together with its keyboard: buttons that are not in `keyboard`
   * disappear, because there is no longer any reason to press them.
   */
  editMessage(
    chatId: string,
    messageId: string,
    html: string,
    keyboard: readonly (readonly InlineButton[])[] = [],
  ): Promise<TelegramCallResult> {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: Number(messageId),
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: markup(keyboard) },
    });
  }

  /**
   * The method is called immediately after intake, before the action is executed (`INV-023`).
   *
   * `alert` shows the text in a dialog that stays until the person closes it, because a toast
   * notification hides a hint that requires action before it has been read to the end.
   */
  answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    alert = false,
  ): Promise<TelegramCallResult> {
    return this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      ...(alert ? { show_alert: true } : {}),
    });
  }

  private async call(method: string, body: unknown): Promise<TelegramCallResult> {
    const token = required(this.config.botToken, 'TELEGRAM_BOT_TOKEN');
    const base = this.config.apiBase;

    const raw = await this.fetchScrubbed(`${base}/bot${token}/${method}`, body, method, token);

    const parsed = response.safeParse(await jsonOf(raw));
    if (!parsed.success) {
      const error = `unrecognised Telegram response to ${method} (status ${raw.status})`;
      this.logger.warn(error);

      return { ok: false, error };
    }

    if (parsed.data.ok) {
      const sent = sentMessage.safeParse(parsed.data.result);

      return sent.success ? { ok: true, messageId: String(sent.data.message_id) } : { ok: true };
    }

    this.logger.warn(`${method} refused: ${parsed.data.description ?? 'no description'}`);

    return {
      ok: false,
      error: parsed.data.description ?? `status ${raw.status}`,
      retryAfterSeconds: parsed.data.parameters?.retry_after,
    };
  }

  /**
   * The token lives in the URL **path** because the Bot API requires that form, and there is no
   * way around it. What can be avoided is something else: a network error includes the whole URL,
   * and the queue writes the error text into a row, so the token would end up in the database in
   * the clear on every failed delivery. Here the token is scrubbed before the error propagates.
   */
  private async fetchScrubbed(
    url: string,
    body: unknown,
    method: string,
    token: string,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`Telegram ${method} failed: ${messageOf(error).split(token).join('***')}`);
    }
  }
}

/**
 * Returns the response body as JSON, or `undefined`, because a proxy or a failure in front of the
 * Bot API also returns HTML. An HTML response becomes a refusal returned as a value, like any
 * other refusal of the provider, not an exception.
 */
async function jsonOf(raw: Response): Promise<unknown> {
  try {
    return await raw.json();
  } catch {
    return undefined;
  }
}

/** A keyboard in the Bot API shape: rows of buttons, each button a new object. */
function markup(keyboard: readonly (readonly InlineButton[])[]): InlineButton[][] {
  return keyboard.map((row) => row.map((button) => ({ ...button })));
}
