import { Injectable } from '@nestjs/common';
import { subDays } from 'date-fns';
import { WebhookReceipt } from '../../generated/prisma/client';
import { EventSource, WebhookReceiptStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../platform/db/prisma.service';
import { storedJson } from '../../platform/db/stored-json';

/**
 * The states in which the event is already settled.
 *
 * `failed` is deliberately not among them. Processing failed, and the receipt has no attempt
 * counter, so treating `failed` as the end would lose the event on a single database failure, at
 * a time when the provider is still ready to redeliver it.
 */
const SETTLED: readonly WebhookReceiptStatus[] = ['processed', 'rejected'];

export interface IncomingEvent {
  readonly source: EventSource;
  readonly externalId: string;
  readonly eventType: string;
  readonly entityId?: string;
  readonly pageId?: string;
  readonly attemptNumber?: number;
  /**
   * A projection for diagnostics: types, identifiers, attempt number — **not content**
   * (`docs/2-system.md` § “`webhook_receipts`”). The caller builds it, so a missing field is
   * visible at the call site.
   */
  readonly diagnostics: Record<string, unknown>;
}

/**
 * Idempotency of inbound events.
 *
 * Deduplication rests on the key, not the status: a redelivery finds the existing row even when
 * the first processing failed. How long rows are kept is stated in
 * `docs/2-system.md` § “`webhook_receipts`”.
 */
@Injectable()
export class WebhookReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Accepts an event: a new one, or one whose work has not finished.
   *
   * `null` means “already settled”: the event was processed or rejected by a rule. A row in the
   * `received` or `failed` state means something else: the work was started and not finished, and
   * the provider's redelivery is a chance to continue it.
   *
   * Idempotency rests on the key, not the status, and no transaction is needed for it
   * (`contracts/canonical.yaml`, key `webhook_receipt`).
   */
  async accept(event: IncomingEvent): Promise<WebhookReceipt | null> {
    const created = await this.prisma.webhookReceipt.createMany({
      data: [
        {
          source: event.source,
          externalId: event.externalId,
          eventType: event.eventType,
          entityId: event.entityId ?? null,
          pageId: event.pageId ?? null,
          attemptNumber: event.attemptNumber ?? null,
          diagnostics: storedJson(event.diagnostics),
        },
      ],
      skipDuplicates: true,
    });

    const receipt = await this.prisma.webhookReceipt.findUniqueOrThrow({
      where: { source_externalId: { source: event.source, externalId: event.externalId } },
    });

    if (created.count === 1) return receipt;

    return SETTLED.includes(receipt.status) ? null : receipt;
  }

  /**
   * Records the page that the work on the event created, so a redelivery finds it in the row and
   * does not create a second one.
   */
  async recordPage(id: string, pageId: string): Promise<void> {
    await this.prisma.webhookReceipt.update({ where: { id }, data: { pageId } });
  }

  /**
   * Prunes receipts older than the idempotency window. The retention period is derived from the
   * provider's behavior (`docs/2-system.md` § “`webhook_receipts`”).
   */
  async pruneOlderThan(days: number): Promise<number> {
    const before = subDays(new Date(), days);
    const { count } = await this.prisma.webhookReceipt.deleteMany({
      where: { receivedAt: { lt: before } },
    });

    return count;
  }

  /**
   * Records that the event was processed, rejected by a rule or failed.
   *
   * `rejected` with a reason is not a formality, because without the difference between “did not
   * arrive” and “arrived and was of no interest”, intake problems cannot be diagnosed.
   */
  async settle(id: string, status: WebhookReceiptStatus, reason?: string): Promise<void> {
    await this.prisma.webhookReceipt.update({
      where: { id },
      data: {
        status,
        // `processedAt` is set only when the event is really settled. `failed` does not get it,
        // because the work is not finished and the provider's redelivery will continue it.
        processedAt: SETTLED.includes(status) ? new Date() : null,
        lastError: reason ?? null,
      },
    });
  }
}
