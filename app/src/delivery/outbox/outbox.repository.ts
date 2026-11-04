import { Inject, Injectable } from '@nestjs/common';
import { addSeconds } from 'date-fns';
import { NotificationOutbox, Prisma } from '../../generated/prisma/client';
import { NotificationDeliveryStatus, PendingActionStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../platform/db/prisma.service';
import { statusIn, statusIs } from '../../platform/db/sql';
import { storedJson } from '../../platform/db/stored-json';
import { Leased } from '../../platform/queue/lease';
import { LeaseQueue } from '../../platform/queue/lease-queue';
import { afterAttempts } from '../../platform/queue/queue.sql';
import { Delivery } from '../delivery.schema';
import { OutboundMessage } from '../port/channel.port';
import { outboxConfig, type OutboxConfig } from './outbox.config';

/** Non-terminal statuses: `contracts/canonical.yaml`, key `notification_delivery`. */
const OPEN: readonly NotificationDeliveryStatus[] = ['pending'];

const STATUS = 'NotificationDeliveryStatus';
const SENT = statusIs(STATUS, NotificationDeliveryStatus.sent);
const FAILED = statusIs(STATUS, NotificationDeliveryStatus.failed);

/** A claimed delivery: what `dispose` acts on, and what the pause is computed from. */
type ClaimedDelivery = Leased & Pick<NotificationOutbox, 'attemptCount'>;

export interface QueuedDelivery extends Omit<Delivery, 'message'> {
  /**
   * The packet as the channel renders it: with the number of remaining proposals, when the App
   * has appended it.
   */
  readonly message: OutboundMessage;
  /**
   * Whether the message breaks through quiet hours. The delivery service sets it according to
   * whoever acts; whoever asks does not set it.
   */
  readonly quietHoursExempt: boolean;
}

/**
 * The delivery queue.
 *
 * It guarantees one thing: a logical delivery enters the queue **once** and is retried until it
 * succeeds or reaches the attempt limit. On the wire, delivery stays at-least-once: exactly-once
 * is guaranteed by the domain effect, not by the queue
 * (`docs/2-system.md` § “Telegram — channel adapter”).
 */
@Injectable()
export class OutboxRepository {
  private readonly queue: LeaseQueue<NotificationOutbox, 'notification_outbox'>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(outboxConfig.KEY) private readonly config: OutboxConfig,
  ) {
    this.queue = new LeaseQueue(prisma, {
      table: 'notification_outbox',
      open: statusIn(STATUS, OPEN),
      // `NULL` means “allowed right away”: a row that has not been tried yet and that nothing has
      // forbidden is due immediately.
      due: Prisma.sql`("next_attempt_at" IS NULL OR "next_attempt_at" <= now())`,
      dueAt: Prisma.sql`"next_attempt_at"`,
      order: Prisma.sql`"created_at"`,
      settings: () => ({
        retireWhen: [afterAttempts(config.maxAttempts)],
        leaseSeconds: config.leaseSeconds,
      }),
      read: (ids) =>
        prisma.notificationOutbox.findMany({
          where: { id: { in: ids } },
          orderBy: { createdAt: 'asc' },
        }),
    });
  }

  /**
   * Enqueues a delivery.
   *
   * Enqueueing the same key again creates nothing and returns the existing row, because two runs
   * about the same situation must not produce two messages.
   */
  async enqueue(delivery: QueuedDelivery): Promise<NotificationOutbox> {
    return this.prisma.$transaction(async (tx) => {
      await tx.notificationOutbox.createMany({
        data: [
          {
            idempotencyKey: delivery.idempotencyKey,
            channel: delivery.channel,
            discussionId: delivery.discussionId ?? null,
            payload: storedJson(delivery.message),
            quietHoursExempt: delivery.quietHoursExempt,
          },
        ],
        skipDuplicates: true,
      });

      const row = await tx.notificationOutbox.findUniqueOrThrow({
        where: { idempotencyKey: delivery.idempotencyKey },
      });

      await tx.notificationProposal.createMany({
        data: (delivery.message.proposals ?? []).map(({ pendingActionId }, position) => ({
          outboxId: row.id,
          pendingActionId,
          position,
        })),
        skipDuplicates: true,
      });

      return row;
    });
  }

  /** Finds a sent message by the id the channel reported, because the person replies to it. */
  findSent(channel: string, externalId: string): Promise<NotificationOutbox | null> {
    return this.prisma.notificationOutbox.findFirst({ where: { channel, externalId } });
  }

  /** Finds the sent messages that include the proposal, because they are edited when it closes. */
  sentFor(pendingActionId: string): Promise<NotificationOutbox[]> {
    return this.prisma.notificationOutbox.findMany({
      where: {
        status: 'sent',
        externalId: { not: null },
        proposals: { some: { pendingActionId } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Records the fate of a proposal in a message and returns the fates of all the settled
   * proposals of the message. Each fate is its own row, so two written at the same time do not
   * overwrite each other.
   */
  async settle(
    outboxId: string,
    pendingActionId: string,
    fate: PendingActionStatus,
  ): Promise<ReadonlyMap<string, PendingActionStatus>> {
    await this.prisma.notificationProposal.updateMany({
      where: { outboxId, pendingActionId },
      data: { fate },
    });

    const decided = await this.prisma.notificationProposal.findMany({
      where: { outboxId, fate: { not: null } },
      select: { pendingActionId: true, fate: true },
    });

    return new Map(
      decided.flatMap(
        ({ pendingActionId: id, fate: decidedFate }): [string, PendingActionStatus][] =>
          decidedFate === null ? [] : [[id, decidedFate]],
      ),
    );
  }

  /** Lists the proposals shown by sent messages whose delivery key starts with `prefix`. */
  async shownWithKeyPrefix(prefix: string): Promise<string[]> {
    const shown = await this.prisma.notificationProposal.findMany({
      where: { outbox: { status: 'sent', idempotencyKey: { startsWith: prefix } } },
      select: { pendingActionId: true },
      orderBy: [{ outbox: { createdAt: 'asc' } }, { position: 'asc' }],
    });

    return shown.map(({ pendingActionId }) => pendingActionId);
  }

  find(idempotencyKey: string): Promise<NotificationOutbox | null> {
    return this.prisma.notificationOutbox.findUnique({ where: { idempotencyKey } });
  }

  /** Claims a batch of deliveries that are due. */
  claimDue(): Promise<Array<NotificationOutbox & Leased>> {
    return this.queue.claimDue(this.config.batchSize);
  }

  /** `externalId` is the message id, if the channel reported one: replies and edits use it. */
  markSent(claimed: ClaimedDelivery, externalId?: string): Promise<boolean> {
    return this.queue.dispose(claimed, 'sent', [
      SENT,
      Prisma.sql`"sent_at" = now()`,
      Prisma.sql`"last_error" = NULL`,
      Prisma.sql`"external_id" = ${externalId ?? null}`,
    ]);
  }

  /**
   * Returns the row to the queue with a pause after a failed attempt. The provider's
   * `retryAfterSeconds` is a floor, not a replacement for the App's own backoff
   * (`docs/2-system.md` § “Telegram — channel adapter”).
   */
  retryLater(
    claimed: ClaimedDelivery,
    error: string,
    retryAfterSeconds?: number,
  ): Promise<boolean> {
    const pause = this.pauseSeconds(claimed.attemptCount, retryAfterSeconds);

    return this.queue.postpone(claimed, addSeconds(new Date(), pause), error, 'retry');
  }

  /**
   * Postpones the row without spending an attempt. Quiet hours are not a delivery failure, and
   * counting them as an attempt would exhaust the limit through overnight waiting.
   */
  postpone(claimed: ClaimedDelivery, until: Date, reason: string): Promise<boolean> {
    return this.queue.postpone(claimed, until, reason);
  }

  /**
   * The row is about to be handed to the provider.
   *
   * Recording the attempt before the work matters more here than anywhere. A process killed in the
   * middle of a send leaves behind a message that may have gone out, and without this record the
   * queue would send it again and again.
   *
   * The method returns the row with the new attempt count, not a flag, because the attempt count
   * is an input to the next decision, the pause before a retry.
   */
  async recordAttempt<Row extends ClaimedDelivery>(claimed: Row): Promise<Row | null> {
    const attemptCount = await this.queue.recordAttempt(claimed);

    return attemptCount === null ? null : { ...claimed, attemptCount };
  }

  /**
   * Gives up on a delivery that will never arrive: there is no channel, or its shape cannot be
   * recognized. Silence here would be worse than `failed`.
   */
  giveUp(claimed: ClaimedDelivery, error: string): Promise<boolean> {
    return this.queue.dispose(claimed, 'give up', [FAILED, Prisma.sql`"last_error" = ${error}`]);
  }

  private pauseSeconds(attemptCount: number, retryAfterSeconds?: number): number {
    const base = this.config.backoffSeconds;
    const cap = this.config.backoffCapSeconds;
    const own = Math.min(base * 2 ** Math.max(attemptCount - 1, 0), cap);

    return Math.max(own, retryAfterSeconds ?? 0);
  }
}
