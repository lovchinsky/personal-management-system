import { randomInt } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { messageOf } from '../../src/platform/error/message-of';
import { telegramConfig, type TelegramConfig } from '../../src/telegram/telegram.config';

/** A message button as the App sent it: the caption and what returns in `callback_query`. */
export interface SentButton {
  readonly text: string;
  readonly data: string;
}

/** A message the App sent or edited: its id, text and keyboard. */
export interface BotMessage {
  readonly messageId: number;
  readonly text: string;
  readonly keyboard: readonly (readonly SentButton[])[];
  readonly at: Date;
}

/** The App's answer to a button press: what it said and what the observer saw at answer time. */
interface BotAnswer {
  readonly callbackQueryId: string;
  readonly text: string;
  readonly alert: boolean;
  readonly observed: unknown;
  readonly at: Date;
}

/** A call the gate did not expect: another method, a foreign chat or a foreign token. */
interface BotViolation {
  readonly method: string;
  readonly reason: string;
  readonly at: Date;
}

/** The maximum size of a call body. A Telegram message fits in a few kilobytes. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * The call body is parsed by a schema, not cast, because what arrives over the network is
 * `unknown`. The fields are those that `TelegramClient` sends, and the listener does not read the
 * rest.
 */
const callSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).optional(),
  text: z.string().default(''),
  message_id: z.number().optional(),
  reply_markup: z
    .object({
      inline_keyboard: z.array(z.array(z.object({ text: z.string(), callback_data: z.string() }))),
    })
    .optional(),
  callback_query_id: z.string().optional(),
  show_alert: z.boolean().optional(),
});

type Call = z.infer<typeof callSchema>;

/**
 * The Bot API of the gate environment (ADR 0041): the App sends here what would go to Telegram in
 * normal operation, because `gate-boot.ts` points `TELEGRAM_API_BASE` at loopback and replaces the
 * bot token with a one-time one. The gate sends nothing to the real Telegram, and the outgoing side
 * of the channel becomes visible: what was sent, with which keyboard, what was edited and how
 * button presses were answered.
 *
 * It answers the three methods `TelegramClient` calls in the Bot API form. Any other method gets a
 * Bot API refusal and a recorded isolation violation. It does not record the request path, because
 * the path contains the token.
 */
@Injectable()
export class BotApi implements OnModuleInit, OnApplicationShutdown {
  private server?: Server;
  private readonly sentMessages: BotMessage[] = [];
  private readonly editedMessages: BotMessage[] = [];
  private readonly answeredQueries: BotAnswer[] = [];
  private readonly foreignCalls: BotViolation[] = [];
  private readonly probes = new Map<string, () => Promise<unknown>>();

  constructor(@Inject(telegramConfig.KEY) private readonly telegram: TelegramConfig) {}

  async onModuleInit(): Promise<void> {
    const url = new URL(this.telegram.apiBase);

    if (url.hostname !== '127.0.0.1') {
      throw new Error(`the gate Bot API must be on loopback, not ${url.hostname}`);
    }

    const server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(url.port), url.hostname, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.server = server;
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;

    this.server = undefined;

    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Returns the port it listens on, for tests that start the listener on a random port. */
  port(): number {
    const address = this.server?.address();

    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  /** Returns the messages sent from `since` on. */
  sent(since?: Date): readonly BotMessage[] {
    return this.sentMessages.filter((message) => since === undefined || message.at >= since);
  }

  /** Returns the edits of message `messageId` in the order the App made them. */
  editsOf(messageId: number): readonly BotMessage[] {
    return this.editedMessages.filter((message) => message.messageId === messageId);
  }

  answers(): readonly BotAnswer[] {
    return this.answeredQueries;
  }

  violations(): readonly BotViolation[] {
    return this.foreignCalls;
  }

  /**
   * Registers what to read at the time the App answers the press `callbackQueryId`, before the
   * answer. The probe makes the order “decision recorded, then answer” visible in one process,
   * without two clocks.
   */
  observeAnswer(callbackQueryId: string, probe: () => Promise<unknown>): void {
    this.probes.set(callbackQueryId, probe);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = /\/bot[^/]+\/([A-Za-z]+)$/.exec(request.url ?? '')?.[1] ?? 'unknown';

    try {
      const token = /\/bot([^/]+)\//.exec(request.url ?? '')?.[1];

      if (request.method !== 'POST' || token !== this.telegram.botToken) {
        return this.refuse(response, method, 'not a call of the gate bot');
      }

      const body = callSchema.parse(await bodyOf(request));

      switch (method) {
        case 'sendMessage':
          return this.sendMessage(response, body);
        case 'editMessageText':
          return this.editMessageText(response, body);
        case 'answerCallbackQuery':
          return await this.answerCallbackQuery(response, body);
        default:
          return this.refuse(response, method, 'a method the App does not call');
      }
    } catch (error) {
      this.refuse(response, method, messageOf(error));
    }
  }

  private sendMessage(response: ServerResponse, body: Call): void {
    if (!this.toAllowedChat(response, 'sendMessage', body)) return;

    const message: BotMessage = {
      messageId: randomInt(2 ** 31, 2 ** 40),
      text: body.text,
      keyboard: keyboardOf(body),
      at: new Date(),
    };

    this.sentMessages.push(message);
    reply(response, 200, { ok: true, result: { message_id: message.messageId } });
  }

  private editMessageText(response: ServerResponse, body: Call): void {
    if (!this.toAllowedChat(response, 'editMessageText', body)) return;

    const messageId = body.message_id;

    if (
      messageId === undefined ||
      !this.sentMessages.some((message) => message.messageId === messageId)
    ) {
      reply(response, 400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: message to edit not found',
      });

      return;
    }

    this.editedMessages.push({
      messageId,
      text: body.text,
      keyboard: keyboardOf(body),
      at: new Date(),
    });
    reply(response, 200, { ok: true, result: { message_id: messageId } });
  }

  private async answerCallbackQuery(response: ServerResponse, body: Call): Promise<void> {
    const callbackQueryId = body.callback_query_id ?? '';
    const probe = this.probes.get(callbackQueryId);

    this.probes.delete(callbackQueryId);
    this.answeredQueries.push({
      callbackQueryId,
      text: body.text,
      alert: body.show_alert === true,
      observed: probe ? await probe() : undefined,
      at: new Date(),
    });
    reply(response, 200, { ok: true, result: true });
  }

  /**
   * Checks whether the message's chat is the gate's allowed chat; if not, answers with a refusal
   * and records a violation.
   */
  private toAllowedChat(response: ServerResponse, method: string, body: Call): boolean {
    if (String(body.chat_id) === this.telegram.allowedChatId) return true;

    this.refuse(response, method, `chat ${String(body.chat_id)} is not the gate chat`);

    return false;
  }

  private refuse(response: ServerResponse, method: string, reason: string): void {
    this.foreignCalls.push({ method, reason, at: new Date() });
    reply(response, 400, { ok: false, error_code: 400, description: `Bad Request: ${reason}` });
  }
}

function reply(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

    size += buffer.length;

    if (size > MAX_BODY_BYTES) throw new Error('the call body is too large');

    chunks.push(buffer);
  }

  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  return parsed;
}

/**
 * Returns the keyboard of a call: captions and `callback_data`. Without `reply_markup` there are no
 * buttons.
 */
function keyboardOf(call: Call): readonly (readonly SentButton[])[] {
  return (call.reply_markup?.inline_keyboard ?? []).map((row) =>
    row.map((button) => ({ text: button.text, data: button.callback_data })),
  );
}
