import { TelegramClient } from '../../src/telegram/telegram.client';
import type { TelegramConfig } from '../../src/telegram/telegram.config';
import { BotApi } from './bot-api';

const TOKEN = 'gate-token';
const CHAT = '1';

/** Starts a listener on a random port, as `gate-boot.ts` sets it up but without the fixed port. */
async function listening(): Promise<{ bot: BotApi; client: (token?: string) => TelegramClient }> {
  const bot = new BotApi({
    botToken: TOKEN,
    allowedChatId: CHAT,
    webhookSecret: 'secret',
    apiBase: 'http://127.0.0.1:0',
  });

  await bot.onModuleInit();

  const client = (token = TOKEN): TelegramClient => {
    const config: TelegramConfig = {
      botToken: token,
      allowedChatId: CHAT,
      webhookSecret: 'secret',
      apiBase: `http://127.0.0.1:${bot.port()}`,
    };

    return new TelegramClient(config);
  };

  return { bot, client };
}

/**
 * The gate environment's Bot API against the App's real client: the listener answers as
 * `TelegramClient` expects, records what was sent and edited and the answers to button presses,
 * and lets nothing foreign in.
 */
describe('the Bot API of the gate environment', () => {
  let opened: BotApi | undefined;

  afterEach(async () => {
    await opened?.onApplicationShutdown();
    opened = undefined;
  });

  it('a sent message gets an id, and the listener gets its text and keyboard', async () => {
    const { bot, client } = await listening();

    opened = bot;

    const sent = await client().sendMessage(CHAT, '<b>Пропозиція</b>', [
      [
        { text: 'Схвалити', callback_data: 'approve:1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b' },
        { text: 'Відхилити', callback_data: 'reject:1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b' },
      ],
    ]);
    const [message] = bot.sent();

    expect(sent).toEqual({ ok: true, messageId: String(message?.messageId) });
    expect(message?.text).toBe('<b>Пропозиція</b>');
    expect(message?.keyboard).toEqual([
      [
        { text: 'Схвалити', data: 'approve:1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b' },
        { text: 'Відхилити', data: 'reject:1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b' },
      ],
    ]);
    // An id outside the int32 range of real Telegram, so it does not collide with the rows of real
    // messages.
    expect(message?.messageId).toBeGreaterThanOrEqual(2 ** 31);
  });

  it('an edit of a known message is recorded with the new keyboard', async () => {
    const { bot, client } = await listening();

    opened = bot;

    const sent = await client().sendMessage(CHAT, 'перше', [[{ text: 'Так', callback_data: 'x' }]]);
    const messageId = sent.ok ? (sent.messageId ?? '') : '';

    await expect(client().editMessage(CHAT, messageId, 'друге')).resolves.toEqual({
      ok: true,
      messageId,
    });
    expect(bot.editsOf(Number(messageId)).map((edit) => [edit.text, edit.keyboard])).toEqual([
      ['друге', []],
    ]);
  });

  it('an unknown message cannot be edited: the refusal has the Bot API form', async () => {
    const { bot, client } = await listening();

    opened = bot;

    await expect(client().editMessage(CHAT, '12345', 'текст')).resolves.toMatchObject({
      ok: false,
      error: 'Bad Request: message to edit not found',
    });
  });

  /** The order “decision recorded, then answer” is read at answer time, before the answer. */
  it('the answer to a press includes what the observer saw at answer time', async () => {
    const { bot, client } = await listening();

    opened = bot;
    bot.observeAnswer('cb-1', () => Promise.resolve('approved'));

    await expect(client().answerCallbackQuery('cb-1', 'Схвалено')).resolves.toEqual({ ok: true });
    expect(bot.answers()).toMatchObject([
      { callbackQueryId: 'cb-1', text: 'Схвалено', alert: false, observed: 'approved' },
    ]);
  });

  it('a foreign token, a foreign chat and an unknown method are refused and recorded as isolation violations', async () => {
    const { bot, client } = await listening();

    opened = bot;

    await expect(client('real-token').sendMessage(CHAT, 'текст')).resolves.toMatchObject({
      ok: false,
    });
    await expect(client().sendMessage('42', 'текст')).resolves.toMatchObject({ ok: false });

    expect(bot.sent()).toEqual([]);
    expect(bot.violations().map((violation) => violation.reason)).toEqual([
      'not a call of the gate bot',
      'chat 42 is not the gate chat',
    ]);
  });

  it('a listener not on loopback does not start', async () => {
    const bot = new BotApi({
      botToken: TOKEN,
      allowedChatId: CHAT,
      webhookSecret: 'secret',
      apiBase: 'https://api.telegram.org',
    });

    await expect(bot.onModuleInit()).rejects.toThrow('must be on loopback');
  });
});
