import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DEFAULT_THROTTLE } from '../../config/throttle.config';
import { notionEventSchema } from './notion-event.schema';
import { NotionIntake } from './notion-intake';
import { NotionSignatureGuard } from './notion-signature.guard';
import { handshakeOf, storeVerificationToken } from './notion-verification';
import { notionWebhookConfig, type NotionWebhookConfig } from './notion-webhook.config';

/**
 * The single endpoint for Notion deliveries.
 *
 * The body is read as `unknown` and parsed with a schema instead of being accepted as a DTO,
 * because the provider's payload includes fields that we do not declare and do not have to declare.
 */
// Only the `webhooks` profile is in effect, because a limit sized for a person would reject a
// burst of provider retries (`docs/2-system.md` § “App — inbound perimeter”).
@SkipThrottle({ [DEFAULT_THROTTLE]: true })
@UseGuards(NotionSignatureGuard)
@Controller('webhooks/notion')
export class NotionWebhookController {
  private readonly logger = new Logger(NotionWebhookController.name);

  constructor(
    private readonly intake: NotionIntake,
    @Inject(notionWebhookConfig.KEY) private readonly webhook: NotionWebhookConfig,
  ) {}

  /**
   * Responds 200 after the receipt commit.
   *
   * The provider redelivers on a non-2xx up to eight times; responding before the commit would
   * mean losing the event at the first failure between the two.
   */
  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ readonly ok: true }> {
    // The same question as in the guard. Outside the provisioning window a handshake request does
    // not get here, and the check exists here so that a reordering cannot revive the branch.
    const token = handshakeOf(body, this.webhook);
    if (token !== null) {
      // The only channel through which Notion passes this token is the endpoint itself. The value
      // is written to tmpfs, not to the log (`docs/2-system.md` § “Subscription verification
      // token”).
      const path = this.webhook.verificationTokenPath;

      await storeVerificationToken(path, token);

      this.logger.warn(
        `Notion verification_token written to ${path} — paste it into the integration settings, ` +
          'store it as NOTION_WEBHOOK_SECRET and restart (RUNBOOK §6.2)',
      );

      return { ok: true };
    }

    const event = notionEventSchema.safeParse(body);
    if (!event.success) {
      // The message stays informative, because it is read not by the client but by whoever
      // investigates why the delivery failed.
      throw new BadRequestException(
        `Unrecognised Notion event shape: ${Object.keys(body ?? {}).join(', ')}`,
      );
    }

    await this.intake.accept(event.data);

    return { ok: true };
  }
}
