import { Injectable, Logger } from '@nestjs/common';
import { messageOf } from '../../platform/error/message-of';
import { IncomingEvent, WebhookReceiptRepository } from './webhook-receipt.repository';

/**
 * How the work on an event ended. What each state means is defined by the receipt lifecycle:
 * `contracts/canonical.yaml`, key `webhook_receipt`.
 */
export type Settlement<T> =
  | { readonly status: 'processed'; readonly value: T }
  | { readonly status: 'rejected'; readonly reason: string };

export function processed<T>(value: T): Settlement<T> {
  return { status: 'processed', value };
}

export function rejected(reason: string): Settlement<never> {
  return { status: 'rejected', reason };
}

/**
 * What the work knows about its receipt.
 *
 * Work that creates a page has no idempotency key from the provider (`GAP-24`). A redelivery that
 * found the work half-done would create a second page. So the work records the created page in the
 * receipt right away, and the redelivery sees it here.
 */
export interface ReceiptHandle {
  /** The page already created by an earlier attempt of this same work. */
  readonly pageId: string | null;
  recordPage(pageId: string): Promise<void>;
}

/**
 * The receipt lifecycle, shared by all sources.
 *
 * A source supplies only the event and the work. A copy of the lifecycle in each source would
 * decide for itself what to leave in the row after a failure, and the copies would diverge right
 * where a record of the failure is needed.
 */
@Injectable()
export class WebhookReceipts {
  private readonly logger = new Logger(WebhookReceipts.name);

  constructor(private readonly receipts: WebhookReceiptRepository) {}

  /**
   * Accepts the event and brings the work on it to the state in which the event is settled.
   *
   * `null` means the event was already settled earlier: a duplicate does nothing. A row whose work
   * started and did not finish (`received`, `failed`) is not a duplicate, because the provider's
   * redelivery continues the work.
   *
   * Only the work itself is in the `try`: `failed` means that the work failed, not the recording
   * of its result. The work's failure must be left in the row with a reason and propagate, so the
   * provider gets a non-2xx and redelivers.
   */
  async receive<T>(
    event: IncomingEvent,
    work: (receipt: ReceiptHandle) => Promise<Settlement<T>>,
  ): Promise<Settlement<T> | null> {
    const receipt = await this.receipts.accept(event);
    if (!receipt) {
      return null;
    }

    let settlement: Settlement<T>;

    try {
      settlement = await work({
        pageId: receipt.pageId,
        recordPage: (pageId) => this.receipts.recordPage(receipt.id, pageId),
      });
    } catch (error) {
      await this.recordFailure(receipt.id, error);

      throw error;
    }

    if (settlement.status === 'rejected') {
      this.logger.log(
        `${event.source} ${event.eventType} ${event.externalId} rejected: ${settlement.reason}`,
      );

      await this.receipts.settle(receipt.id, 'rejected', settlement.reason);
    } else {
      await this.receipts.settle(receipt.id, 'processed');
    }

    return settlement;
  }

  /** Prunes receipts older than the idempotency window, for maintenance. */
  pruneOlderThan(days: number): Promise<number> {
    return this.receipts.pruneOlderThan(days);
  }

  /**
   * Records the work's failure in the row.
   *
   * If recording fails too, the error that is thrown states both facts, and the work's failure
   * stays as its cause, because that is what needs fixing.
   */
  private async recordFailure(id: string, error: unknown): Promise<void> {
    try {
      await this.receipts.settle(id, 'failed', messageOf(error));
    } catch (settleError) {
      throw new Error(
        `receipt ${id}: work failed and recording the failure failed too: ${messageOf(settleError)}`,
        {
          cause: error,
        },
      );
    }
  }
}
