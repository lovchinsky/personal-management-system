import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProposalFate } from '../approvals/proposal-notice';
import { appConfig, type AppConfig } from '../config/app.config';
import type { WakeFailure } from '../continuations/wake-failure-notice';
import { NotificationOutbox } from '../generated/prisma/client';
import { ConnectedClient } from '../mcp/oauth/client-notice';
import { messageOf } from '../platform/error/message-of';
import { InvalidRequestError, parsedRequest } from '../platform/request/invalid-request';
import { localDateAt } from '../platform/time/local-day';
import { Actor, onPersonsRequest } from '../runs/actor';
import { BreakerOpening } from '../runs/breaker-notice';
import type { NotionWait } from '../runs/notion-wait-notice';
import { requestedByPerson } from '../runs/provenance';
import { textsOf, type Texts } from '../texts/texts';
import { breakerDelivery } from './breaker.message';
import { connectionDelivery } from './connection.message';
import { runDeliveryKey } from './delivery-key';
import { Delivery, DeliveryRequest, deliverySchema } from './delivery.schema';
import {
  DeliveryAbsentWire,
  deliveryStateOf,
  DeliveryStateWire,
  DeliveryWindowWire,
  stagedDeliveryOf,
} from './delivery.wire';
import { notionGaveUpDelivery, notionWaitingDelivery } from './notion-wait.message';
import { OutboxRepository } from './outbox/outbox.repository';
import { QuietHours } from './outbox/quiet-hours';
import { MAX_MORE_PROPOSALS, OutboundMessage, outboundMessageSchema } from './port/channel.port';
import { ChannelRegistry } from './port/channel.registry';
import { packetFor } from './port/packet';
import { outcomesOf } from './proposal-outcomes';
import { ReviewFailure, reviewFailureDelivery } from './review-failure.message';
import { wakeFailureDelivery } from './wake-failure.message';

/**
 * The delivery capability, which is the single entry point for anyone who wants to tell the
 * person something.
 *
 * Two decisions are made here, not in the queue and not by the caller.
 *
 * The packet is checked against the port schema before the queue. Otherwise an ask that does not
 * fit the limit, or a link that is not https, would become a row that the worker would retire
 * when the one who composed it is no longer there, and the renderer's promise “a packet that
 * does not fit never reaches the queue” would be mere words.
 *
 * Exemption from quiet hours is derived from whoever acts, by the same classifier that decides
 * on the budget, and is not passed by the caller, because whoever wants to speak cannot be
 * trusted here (`docs/3-policy.md` § “Quiet hours”). The worker checks the window itself before
 * sending.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly quiet: QuietHours,
    private readonly channels: ChannelRegistry,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * Checks a request without enqueueing anything: the port schema, where the proposals lead, and
   * whether the packet fits whole into the channel's message.
   *
   * A proposal in the packet must still await the person's decision. Otherwise the person would
   * press a button with nothing behind it.
   */
  async check(request: DeliveryRequest, proposals: ProposalLookup): Promise<Delivery> {
    const delivery = this.admitted(request);

    for (const { pendingActionId } of delivery.message.proposals ?? []) {
      if (!(await proposals.awaitsDecision(pendingActionId))) {
        throw new InvalidRequestError(
          `delivery: proposal ${pendingActionId} is one this run did not propose ` +
            "and which does not await the person's decision",
        );
      }
    }

    return delivery;
  }

  /**
   * Enqueues a delivery. A repeat of the same key returns the existing row and enqueues nothing.
   *
   * A packet with proposals also reports the rest that await the person's decision: the approvals
   * capability counts how many there are at the time of enqueueing. A packet without proposals
   * says nothing about them.
   *
   * The method is `async` on purpose, because a refusal must arrive as a rejected promise, like
   * any other failure of the call, not as an exception thrown before it.
   */
  async enqueue(
    actor: Actor,
    request: DeliveryRequest,
    proposals: ProposalLookup,
  ): Promise<NotificationOutbox> {
    const delivery = this.admitted(request);
    const shown = (delivery.message.proposals ?? []).map((line) => line.pendingActionId);
    const others = shown.length === 0 ? 0 : await proposals.waitingBesides(shown);
    const message: OutboundMessage = {
      ...delivery.message,
      ...(others > 0 ? { moreProposals: Math.min(others, MAX_MORE_PROPOSALS) } : {}),
    };

    return this.outbox.enqueue({ ...delivery, message, quietHoursExempt: onPersonsRequest(actor) });
  }

  /**
   * Tells the person that the breaker has opened. The system speaks and the person did not ask, so
   * it respects quiet hours. A repeat about the same opening enqueues nothing, because the key
   * comes from the last failed run.
   *
   * A failure here is thrown, because a notification that did not reach the queue must be
   * repeated.
   */
  async breakerOpened(opening: BreakerOpening): Promise<void> {
    const delivery = parsedRequest(
      deliverySchema,
      breakerDelivery(opening, this.texts().notices.breaker),
      'breaker notice',
    );

    await this.outbox.enqueue({ ...delivery, quietHoursExempt: false });
  }

  /**
   * Tells the person that a review occurrence did not take place. The system speaks and the person
   * did not ask, so it respects quiet hours. The key is the review and the period, so a repeat
   * enqueues no second message.
   */
  async reviewFailed(failure: ReviewFailure): Promise<void> {
    const delivery = parsedRequest(
      deliverySchema,
      reviewFailureDelivery(
        failure,
        this.texts().notices.reviewFailure,
        this.app.language,
        localDateAt(this.app.timeZone, new Date()),
      ),
      'review failure notice',
    );

    await this.outbox.enqueue({ ...delivery, quietHoursExempt: false });
  }

  /**
   * Tells the person that a wake whose time they named did not take place. The notice breaks
   * through quiet hours just as the reminder of the run for that wake would have, because the
   * person named the time.
   */
  async wakeFailed(failure: WakeFailure): Promise<void> {
    const delivery = parsedRequest(
      deliverySchema,
      wakeFailureDelivery(
        failure,
        this.texts().notices.wakeFailure,
        { language: this.app.language, timeZone: this.app.timeZone, gender: this.app.ownerGender },
        new Date(),
      ),
      'wake failure notice',
    );
    const quietHoursExempt = requestedByPerson({
      origin: 'scheduled_check',
      reasonCode: failure.reasonCode,
    });

    await this.outbox.enqueue({ ...delivery, quietHoursExempt });
  }

  /**
   * Tells a person who replied in the channel that Notion is unavailable and the answer will come
   * as soon as Notion is back (ADR 0045). The person speaks, so the notice breaks through quiet
   * hours.
   */
  async notionWaiting(wait: NotionWait): Promise<void> {
    await this.enqueuePersonsWait(
      notionWaitingDelivery(wait, this.texts().notices.notionWait),
      'notion wait notice',
    );
  }

  /**
   * Tells the person that their reply waited for Notion for a day and there will be no answer
   * (ADR 0045).
   */
  async notionGaveUp(wait: NotionWait): Promise<void> {
    await this.enqueuePersonsWait(
      notionGaveUpDelivery(wait, this.texts().notices.notionWait),
      'notion gave-up notice',
    );
  }

  private async enqueuePersonsWait(request: Delivery, what: string): Promise<void> {
    const delivery = parsedRequest(deliverySchema, request, what);

    await this.outbox.enqueue({ ...delivery, quietHoursExempt: true });
  }

  /**
   * Tells the owner that a client has been connected to the App MCP. The system speaks and the
   * person did not ask, so it respects quiet hours.
   */
  async clientConnected(client: ConnectedClient): Promise<void> {
    const delivery = parsedRequest(
      deliverySchema,
      connectionDelivery(client, this.texts().notices.connection),
      'connection notice',
    );

    await this.outbox.enqueue({ ...delivery, quietHoursExempt: false });
  }

  /**
   * Returns the texts the App itself uses to speak to the person, in the installation's language
   * (ADR 0042).
   */
  private texts(): Texts {
    return textsOf(this.app.language);
  }

  /**
   * Checks whether there is a way to speak to the person: at least one channel is configured. A
   * scheduled review without a channel is not scheduled, because its packet could be delivered to
   * no one (ADR 0036).
   */
  hasChannel(): boolean {
    return this.channels.any();
  }

  /**
   * Finds the thread a sent message was about, by the id the channel reported when the message was
   * delivered. `null` means the message is unknown or not about a thread: a reply to it continues
   * nothing.
   */
  async threadOf(channel: string, externalId: string): Promise<string | null> {
    const row = await this.outbox.findSent(channel, externalId);

    return row?.discussionId ?? null;
  }

  /**
   * Rewrites a message that includes a proposal: adds beside the proposal what became of it, and
   * removes its buttons. The buttons of the packet's other proposals stay.
   *
   * The rewrite is cosmetic and not part of the decision, so a failure here is not thrown. The
   * decision is already recorded or executed, and neither a rejection nor a retry will change it
   * (`INV-023`). A channel that cannot edit, or a message without an id, is left as is.
   */
  async showOutcome(pendingActionId: string, fate: ProposalFate): Promise<void> {
    let rows: NotificationOutbox[];

    try {
      rows = await this.outbox.sentFor(pendingActionId);
    } catch (error) {
      this.logger.warn(`outcome of ${pendingActionId} was not shown: ${messageOf(error)}`);

      return;
    }

    // Each message is handled separately, so a failure of one does not leave the settled
    // proposal's buttons on the others.
    for (const row of rows) {
      try {
        await this.showIn(row, pendingActionId, fate);
      } catch (error) {
        this.logger.warn(`message ${row.idempotencyKey} was not edited: ${messageOf(error)}`);
      }
    }
  }

  private async showIn(
    row: NotificationOutbox,
    pendingActionId: string,
    fate: ProposalFate,
  ): Promise<void> {
    const channel = this.channels.find(row.channel);
    const message = outboundMessageSchema.safeParse(row.payload);

    if (!channel?.edit || row.externalId === null || !message.success) return;

    const fates = await this.outbox.settle(row.id, pendingActionId, fate);
    const receipt = await channel.edit(
      row.externalId,
      packetFor(channel, message.data),
      outcomesOf(fates, this.texts().outcomes),
    );

    if (!receipt.ok) {
      this.logger.warn(`message ${row.idempotencyKey} was not edited: ${receipt.error}`);
    }
  }

  /**
   * Lists the proposals shown by sent packets for causes whose `event_id` starts with
   * `causePrefix`: the ones the person saw as buttons.
   */
  proposalsShown(causePrefix: string): Promise<string[]> {
    return this.outbox.shownWithKeyPrefix(runDeliveryKey(causePrefix));
  }

  /**
   * Looks up the state of a delivery by its key: a queue row, what this run enqueued (`staged`),
   * or absence.
   */
  async state(
    idempotencyKey: string,
    staged: readonly Delivery[] = [],
  ): Promise<DeliveryStateWire | DeliveryAbsentWire> {
    const row = await this.outbox.find(idempotencyKey);
    if (row) {
      return deliveryStateOf(row);
    }

    const written = staged.find((request) => request.idempotencyKey === idempotencyKey);

    return written ? stagedDeliveryOf(written) : { idempotency_key: idempotencyKey, found: false };
  }

  /** Returns the request once it has passed the schema and fits into a message of its channel. */
  private admitted(request: DeliveryRequest): Delivery {
    const delivery = parsedRequest(deliverySchema, request, 'delivery');
    const excess = this.channels.find(delivery.channel)?.excess(delivery.message) ?? 0;

    if (excess > 0) {
      throw new InvalidRequestError(
        `delivery: the packet is ${excess} characters longer than one ${delivery.channel} ` +
          'message — noticed, why_it_matters, the proposal lines and the ask must fit whole ' +
          '(context and prepared are dropped when there is no room); shorten them by that much',
      );
    }

    return delivery;
  }

  /**
   * Reports when a delivery that the actor enqueues at this time will be sent. The exemption is
   * decided by the same classifier as at enqueueing.
   */
  window(actor: Actor): DeliveryWindowWire {
    if (onPersonsRequest(actor)) return { quiet_hours_exempt: true };

    const until = this.quiet.silentUntil();

    return until
      ? { quiet_hours_exempt: false, silent_until: until.toISOString() }
      : { quiet_hours_exempt: false };
  }
}

/**
 * The proposals a packet speaks about: where a button may lead — to a proposal that still awaits
 * the person's decision or was written by the same run — and how many more are waiting outside
 * the packet.
 *
 * Delivery asks and does not know, because proposals belong to approvals, and the answer is
 * composed by whoever sees both capabilities.
 */
export interface ProposalLookup {
  awaitsDecision(pendingActionId: string): Promise<boolean>;
  waitingBesides(pendingActionIds: readonly string[]): Promise<number>;
}
