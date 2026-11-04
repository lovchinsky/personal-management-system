import { Global, Module } from '@nestjs/common';
import { PROPOSAL_NOTICE_ADAPTER, type ProposalNotice } from '../approvals/proposal-notice';
import {
  WAKE_FAILURE_NOTICE_ADAPTER,
  type WakeFailureNotice,
} from '../continuations/wake-failure-notice';
import { CLIENT_NOTICE_ADAPTER, type ClientNotice } from '../mcp/oauth/client-notice';
import { BREAKER_NOTICE_ADAPTER, type BreakerNotice } from '../runs/breaker-notice';
import { NOTION_WAIT_NOTICE_ADAPTER, type NotionWaitNotice } from '../runs/notion-wait-notice';
import { DeliveryModule } from './delivery.module';
import { DeliveryService } from './delivery.service';

/**
 * Delivery adapters under the ports of other capabilities.
 *
 * The module is global because it plugs itself in behind the ports of approvals, runs,
 * continuations and OAuth. None of these capabilities knows about delivery, and delivery alone
 * knows which message showed a proposal and how to tell the person that the breaker has opened, a
 * wake did not take place or Notion is unavailable while the person waits for an answer.
 */
@Global()
@Module({
  imports: [DeliveryModule],
  providers: [
    {
      provide: PROPOSAL_NOTICE_ADAPTER,
      useFactory: (delivery: DeliveryService): ProposalNotice => ({
        settled: (pendingActionId, fate) => delivery.showOutcome(pendingActionId, fate),
      }),
      inject: [DeliveryService],
    },
    {
      provide: BREAKER_NOTICE_ADAPTER,
      useFactory: (delivery: DeliveryService): BreakerNotice => ({
        opened: (opening) => delivery.breakerOpened(opening),
      }),
      inject: [DeliveryService],
    },
    {
      provide: NOTION_WAIT_NOTICE_ADAPTER,
      useFactory: (delivery: DeliveryService): NotionWaitNotice => ({
        waiting: (wait) => delivery.notionWaiting(wait),
        gaveUp: (wait) => delivery.notionGaveUp(wait),
      }),
      inject: [DeliveryService],
    },
    {
      provide: WAKE_FAILURE_NOTICE_ADAPTER,
      useFactory: (delivery: DeliveryService): WakeFailureNotice => ({
        failed: (failure) => delivery.wakeFailed(failure),
      }),
      inject: [DeliveryService],
    },
    {
      provide: CLIENT_NOTICE_ADAPTER,
      useFactory: (delivery: DeliveryService): ClientNotice => ({
        connected: (client) => delivery.clientConnected(client),
      }),
      inject: [DeliveryService],
    },
  ],
  exports: [
    PROPOSAL_NOTICE_ADAPTER,
    BREAKER_NOTICE_ADAPTER,
    NOTION_WAIT_NOTICE_ADAPTER,
    WAKE_FAILURE_NOTICE_ADAPTER,
    CLIENT_NOTICE_ADAPTER,
  ],
})
export class DeliveryNoticesModule {}
