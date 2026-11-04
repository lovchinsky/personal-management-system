import { Inject, Injectable } from '@nestjs/common';
import { secondsToMilliseconds } from 'date-fns';
import { NotificationOutbox } from '../../generated/prisma/client';
import { messageOf } from '../../platform/error/message-of';
import { Leased } from '../../platform/queue/lease';
import { PollingWorker } from '../../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../../platform/worker/workers.config';
import { NotificationChannel, OutboundMessage, outboundMessageSchema } from '../port/channel.port';
import { ChannelRegistry } from '../port/channel.registry';
import { packetFor } from '../port/packet';
import { outboxConfig, type OutboxConfig } from './outbox.config';
import { OutboxRepository } from './outbox.repository';
import { QuietHours } from './quiet-hours';

/**
 * Delivery from the queue.
 *
 * The row is written **before** the first attempt to send, so a restart between enqueueing and
 * delivery does not lose the delivery: the next tick finds the row with the expired lease and
 * finishes the job. That is `SCEN-19-33`.
 */
@Injectable()
export class OutboxWorker extends PollingWorker {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly channels: ChannelRegistry,
    private readonly quiet: QuietHours,
    @Inject(outboxConfig.KEY) private readonly config: OutboxConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return secondsToMilliseconds(this.config.tickSeconds);
  }

  protected async tick(): Promise<number> {
    const due = await this.outbox.claimDue();

    for (const row of due) {
      await this.deliver(row);
    }

    return due.length;
  }

  private async deliver(row: NotificationOutbox & Leased): Promise<void> {
    const channel = this.channels.find(row.channel);
    if (!channel) {
      await this.outbox.giveUp(row, `channel ${row.channel} is not configured`);

      return;
    }

    // Quiet hours are checked here, not at enqueueing: otherwise a row enqueued a minute before
    // quiet hours would go out in the middle of them
    // (`docs/2-system.md` § “Telegram — channel adapter”).
    const silentUntil = row.quietHoursExempt ? null : this.quiet.silentUntil();
    if (silentUntil) {
      await this.outbox.postpone(row, silentUntil, 'quiet hours');

      return;
    }

    const message = outboundMessageSchema.safeParse(row.payload);

    // A row whose shape cannot be recognized does not become usable by retrying: it was either
    // written by another version or is corrupted. Retrying it forever would keep the queue busy
    // with what will never arrive.
    if (!message.success) {
      // This delivery will never arrive, and silence here would be worse than `failed`.
      await this.outbox.giveUp(row, `unrecognised payload: ${message.error.message}`);

      return;
    }

    await this.send(row, channel, packetFor(channel, message.data));
  }

  /**
   * Records the attempt before the provider is called, and from then on works with the row in its
   * updated form. The pause before a retry is computed from the number of attempts made, not from
   * the count the row had before this one.
   */
  private async send(
    row: NotificationOutbox & Leased,
    channel: NotificationChannel,
    packet: OutboundMessage,
  ): Promise<void> {
    const charged = await this.outbox.recordAttempt(row);
    if (!charged) {
      return;
    }

    try {
      const receipt = await channel.send(packet, charged.idempotencyKey);
      if (receipt.ok) {
        await this.outbox.markSent(charged, receipt.externalId);

        return;
      }

      await this.outbox.retryLater(charged, receipt.error, receipt.retryAfterSeconds);
    } catch (error) {
      // An exception from the channel is no better than a refusal: the row must go back to the
      // queue, otherwise the delivery would be lost on the very first network failure.
      await this.outbox.retryLater(charged, messageOf(error));
    }
  }
}
