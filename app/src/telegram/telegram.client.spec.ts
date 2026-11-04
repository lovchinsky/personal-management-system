import { TelegramClient } from './telegram.client';
import { type TelegramConfig } from './telegram.config';

const TOKEN = '123456:SECRET_BOT_TOKEN_VALUE';

/**
 * The token must not leak into the error text.
 *
 * It lives in the URL path because the Bot API requires that form. A network error includes the
 * whole URL, and the delivery queue writes the error text into a row, so without scrubbing the
 * token would end up in the database in the clear on every failed delivery.
 */
describe('TelegramClient', () => {
  const client = (apiBase: string): TelegramClient => {
    const telegram: TelegramConfig = {
      botToken: TOKEN,
      allowedChatId: undefined,
      webhookSecret: undefined,
      apiBase,
    };

    return new TelegramClient(telegram);
  };

  it('an API base without a scheme keeps the token out of the error message', async () => {
    // `fetch` on a string without a scheme throws a TypeError, and its text contains the whole URL.
    const failing = client('api.telegram.org');

    await expect(failing.sendMessage('1', 'текст')).rejects.toThrow(/Telegram sendMessage failed/);
    await expect(failing.sendMessage('1', 'текст')).rejects.not.toThrow(
      new RegExp(TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('a marker stays in place of the token', async () => {
    const failing = client('api.telegram.org');

    await expect(failing.sendMessage('1', 'текст')).rejects.toThrow(/\*\*\*/);
  });

  /**
   * A hung call would keep the webhook response open, and Telegram would redeliver the update in
   * parallel with the first one. The time limit is a signal that cancels the call.
   */
  it('every Bot API call has a time limit', async () => {
    const calls: RequestInit[] = [];

    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      calls.push(init ?? {});

      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });

    await client('https://api.telegram.org').answerCallbackQuery('cb-1', 'Гаразд');

    // The duration is not checked here: the client's `AbortSignal` and the one in the jest test
    // come from different realms, so a spy on `AbortSignal.timeout` does not see the call. What is
    // checked is that the signal exists and has not fired yet.
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(false);
  });

  /**
   * A proxy in front of the Bot API returns HTML on failure. An HTML response is a refusal
   * returned as a value, like the rest of the provider's refusals, because an exception here would
   * break the class's promise, and the delivery queue would read it as a network failure.
   */
  it('a non-JSON response becomes a refusal, not an exception', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));

    await expect(client('https://api.telegram.org').sendMessage('1', 'текст')).resolves.toEqual({
      ok: false,
      error: 'unrecognised Telegram response to sendMessage (status 502)',
    });
  });

  /**
   * The id of the sent message is the only thing that lets the person reply to it and the system
   * edit it. Its absence does not make the delivery fail, because the message has already gone
   * out and a retry would produce a duplicate.
   */
  it('the `sendMessage` response names the message id', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 31 } })));

    await expect(client('https://api.telegram.org').sendMessage('1', 'текст')).resolves.toEqual({
      ok: true,
      messageId: '31',
    });
  });

  it('a message without an id remains a success', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true })));

    await expect(client('https://api.telegram.org').sendMessage('1', 'текст')).resolves.toEqual({
      ok: true,
    });
  });

  /**
   * No buttons remain after a decision: an edit sends an empty keyboard instead of leaving the
   * old one.
   */
  it('an edit rewrites the text and removes the buttons', async () => {
    const bodies: unknown[] = [];

    jest.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

      bodies.push([target.split('/').pop(), body]);

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { message_id: 31 } })),
      );
    });

    await expect(
      client('https://api.telegram.org').editMessage('42', '31', 'текст'),
    ).resolves.toEqual({ ok: true, messageId: '31' });

    expect(bodies).toEqual([
      [
        'editMessageText',
        {
          chat_id: '42',
          message_id: 31,
          text: 'текст',
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: [] },
        },
      ],
    ]);
  });
});
