import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { telegramConfig, type TelegramConfig } from '../../../telegram/telegram.config';
import { sameSecret } from '../../webhook-secret';
import { chatIdOf, telegramUpdateSchema } from './telegram-update.schema';

const HEADER = 'x-telegram-bot-api-secret-token';

/**
 * The guard runs two independent checks, because Telegram does not sign the webhook.
 *
 * The first is the header secret passed to `setWebhook`. The second is the chat: even with the
 * right secret, an update from a foreign chat is not ours.
 *
 * `INV-022`: An update that fails either of the two checks is discarded with no durable effect and
 * no reply to the source chat. A reply to a foreign chat would tell the sender that the endpoint
 * is alive.
 */
@Injectable()
export class TelegramSecretGuard implements CanActivate {
  constructor(@Inject(telegramConfig.KEY) private readonly config: TelegramConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[HEADER];
    const expected = this.config.webhookSecret;

    // An unconfigured channel has nothing to check with, so everything is rejected. This is not a
    // server error: the endpoint exists, but the installation has not enabled it.
    if (!expected || typeof provided !== 'string' || !sameSecret(provided, expected)) {
      throw new UnauthorizedException();
    }

    const update = telegramUpdateSchema.safeParse(request.body);
    if (!update.success) {
      throw new UnauthorizedException();
    }

    const allowed = this.config.allowedChatId;

    if (!allowed || chatIdOf(update.data) !== allowed) throw new UnauthorizedException();

    return true;
  }
}
