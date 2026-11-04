import { Test } from '@nestjs/testing';
import { PROPOSAL_ID, TELEGRAM_CONFIG } from '../../../../test/fixtures/telegram';
import { appConfig } from '../../../config/app.config';
import {
  InlineButton,
  TelegramCallResult,
  TelegramClient,
} from '../../../telegram/telegram.client';
import { telegramConfig } from '../../../telegram/telegram.config';
import { OutboundMessage } from '../../port/channel.port';
import { TelegramChannel } from './telegram.channel';

const CHAT_ID = TELEGRAM_CONFIG.allowedChatId;

const PACKET: OutboundMessage = {
  noticed: 'Задача стоїть у Waiting For одинадцять днів.',
  whyItMatters: 'Дедлайн через три дні.',
  ask: 'Перевести в Next Action?',
  link: 'https://notion.so/page-1',
  proposals: [{ pendingActionId: PROPOSAL_ID, line: 'Перевести задачу в Next Action' }],
  actions: [
    { kind: 'approve', pendingActionId: PROPOSAL_ID },
    { kind: 'reject', pendingActionId: PROPOSAL_ID },
  ],
};

type Keyboard = readonly (readonly InlineButton[])[];

/**
 * The transport is a legitimate thing to stub: it makes no decisions and only goes out to the
 * network. The delivery path is tested on `ScriptedChannel`, a different class, so only these
 * tests cover what lies between the queue and the wire.
 */
class FakeClient implements Pick<TelegramClient, 'sendMessage' | 'editMessage'> {
  readonly sent: { chatId: string; html: string; keyboard: Keyboard }[] = [];
  readonly edited: { chatId: string; messageId: string; html: string; keyboard: Keyboard }[] = [];
  result: TelegramCallResult = { ok: true };

  editMessage(
    chatId: string,
    messageId: string,
    html: string,
    keyboard: Keyboard = [],
  ): Promise<TelegramCallResult> {
    this.edited.push({ chatId, messageId, html, keyboard });

    return Promise.resolve(this.result);
  }

  sendMessage(chatId: string, html: string, keyboard: Keyboard = []): Promise<TelegramCallResult> {
    this.sent.push({ chatId, html, keyboard });

    return Promise.resolve(this.result);
  }
}

describe('Telegram channel', () => {
  let client: FakeClient;
  let channel: TelegramChannel;

  beforeEach(async () => {
    client = new FakeClient();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TelegramChannel,
        { provide: TelegramClient, useValue: client },
        { provide: telegramConfig.KEY, useValue: TELEGRAM_CONFIG },
        { provide: appConfig.KEY, useValue: { ...appConfig(), language: 'uk' } },
      ],
    }).compile();

    channel = moduleRef.get(TelegramChannel);
  });

  it('sends a packet to the allowed chat as markup with the proposal buttons', async () => {
    await expect(channel.send(PACKET, 'nudge-1')).resolves.toEqual({ ok: true });

    const [sent] = client.sent;

    expect(sent.chatId).toBe(CHAT_ID);
    expect(sent.html).toContain(PACKET.ask);
    expect(sent.keyboard).toEqual([
      [
        { text: '✓ Підтвердити', callback_data: `approve:${PROPOSAL_ID}` },
        { text: '✕ Відхилити', callback_data: `reject:${PROPOSAL_ID}` },
      ],
    ]);
  });

  /**
   * `retry_after` must reach the queue: it is what tells “try later” from “failed”. The flood-wait
   * tests feed the value straight into a stub channel, so only this test covers carrying it over
   * from the provider's reply.
   */
  it('carries the reason and the backoff pause of a provider error to the queue', async () => {
    client.result = { ok: false, error: 'Too Many Requests', retryAfterSeconds: 42 };

    await expect(channel.send(PACKET, 'nudge-1')).resolves.toEqual({
      ok: false,
      error: 'Too Many Requests',
      retryAfterSeconds: 42,
    });
  });

  /** The message id from the Bot API receipt reaches the queue: replies and edits use it. */
  it('the receipt includes the message id the provider reported', async () => {
    client.result = { ok: true, messageId: '31' };

    await expect(channel.send(PACKET, 'nudge-1')).resolves.toEqual({
      ok: true,
      externalId: '31',
    });
  });

  it("editing rewrites the same message in the allowed chat, without a settled proposal's buttons", async () => {
    const settled = new Map([[PROPOSAL_ID, 'Виконано']]);

    await expect(channel.edit('31', PACKET, settled)).resolves.toEqual({ ok: true });

    const [edited] = client.edited;

    expect(edited.chatId).toBe(CHAT_ID);
    expect(edited.messageId).toBe('31');
    expect(edited.html).toContain(PACKET.ask);
    expect(edited.html).toContain('Перевести задачу в Next Action — <i>Виконано</i>');
    expect(edited.keyboard).toEqual([]);
  });

  it('an edit refusal is a refusal with a reason', async () => {
    client.result = { ok: false, error: 'message is not modified' };

    await expect(channel.edit('31', PACKET, new Map([[PROPOSAL_ID, 'Виконано']]))).resolves.toEqual(
      {
        ok: false,
        error: 'message is not modified',
      },
    );
  });
});
