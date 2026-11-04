import { Module } from '@nestjs/common';
import { WebhookReceiptRepository } from './webhook-receipt.repository';
import { WebhookReceipts } from './webhook-receipts';

/**
 * Idempotency of inbound events and the receipt lifecycle, shared by all sources. Only the
 * lifecycle is exported: the receipt store stays inside.
 */
@Module({
  providers: [WebhookReceiptRepository, WebhookReceipts],
  exports: [WebhookReceipts],
})
export class IntakeReceiptsModule {}
