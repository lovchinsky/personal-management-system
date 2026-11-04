import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { type TelegramConfig } from '../../../telegram/telegram.config';
import { TelegramSecretGuard } from './telegram-secret.guard';

const SECRET = 'telegram-webhook-secret';
const CHAT = '42';

const TELEGRAM: TelegramConfig = {
  botToken: 'token',
  allowedChatId: CHAT,
  webhookSecret: SECRET,
  apiBase: 'https://api.telegram.org',
};

function contextOf(headers: Record<string, string | undefined>, body: unknown): ExecutionContext {
  return new ExecutionContextHost([{ headers, body }]);
}

const update = (chatId: string | number = CHAT): unknown => ({
  update_id: 1,
  message: { message_id: 2, chat: { id: chatId }, text: 'ідея' },
});

/**
 * `INV-022`: An update that fails either of the two checks is discarded with no durable effect and
 * no reply to the source chat.
 *
 * There are two checks because Telegram does not sign the webhook: the header secret on its own
 * does not say that the update concerns us.
 */
describe('TelegramSecretGuard', () => {
  const guard = new TelegramSecretGuard(TELEGRAM);

  const good = { 'x-telegram-bot-api-secret-token': SECRET };

  it('lets through the right secret with an allowed chat', () => {
    expect(guard.canActivate(contextOf(good, update()))).toBe(true);
  });

  it('accepts the chat as both a number and a string', () => {
    expect(guard.canActivate(contextOf(good, update(42)))).toBe(true);
  });

  it('does not let through an update without the secret', () => {
    expect(() => guard.canActivate(contextOf({}, update()))).toThrow(UnauthorizedException);
  });

  it('does not let through a wrong secret', () => {
    expect(() =>
      guard.canActivate(contextOf({ 'x-telegram-bot-api-secret-token': 'wrong' }, update())),
    ).toThrow(UnauthorizedException);
  });

  /** The right secret from a foreign chat is the case the second check exists for. */
  it('does not let through the right secret from a foreign chat', () => {
    expect(() => guard.canActivate(contextOf(good, update('999')))).toThrow(UnauthorizedException);
  });

  it('does not let through an update without a chat', () => {
    expect(() => guard.canActivate(contextOf(good, { update_id: 1 }))).toThrow(
      UnauthorizedException,
    );
  });

  it('does not let through a body of an unfamiliar shape', () => {
    expect(() => guard.canActivate(contextOf(good, { nothing: true }))).toThrow(
      UnauthorizedException,
    );
  });
});
