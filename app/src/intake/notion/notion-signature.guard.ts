import { createHmac } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { sameSecret } from '../webhook-secret';
import { handshakeOf } from './notion-verification';
import { notionWebhookConfig, type NotionWebhookConfig } from './notion-webhook.config';

const HEADER = 'x-notion-signature';
const PREFIX = 'sha256=';

/**
 * The signature covers the **raw** body, and the key is the same `verification_token` that Notion
 * uses to verify the subscription. The check is a guard, not part of the handler, because an
 * unsigned delivery must not reach a place where it writes anything.
 *
 * A request with a token is let through without a signature **only during provisioning**.
 * Otherwise it would be enough to put a field with the token's name into the body to bypass the
 * check (`docs/2-system.md` § “Subscription verification token”).
 */
@Injectable()
export class NotionSignatureGuard implements CanActivate {
  constructor(@Inject(notionWebhookConfig.KEY) private readonly config: NotionWebhookConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();

    if (handshakeOf(request.body, this.config) !== null) return true;

    const provided = request.headers[HEADER];
    const raw = request.rawBody;

    if (typeof provided !== 'string' || !provided.startsWith(PREFIX) || !raw) {
      throw new UnauthorizedException('Missing Notion signature');
    }

    const expected = `${PREFIX}${createHmac('sha256', this.config.secret).update(raw).digest('hex')}`;

    if (!sameSecret(provided, expected)) {
      throw new UnauthorizedException('Invalid Notion signature');
    }

    return true;
  }
}
