import { Test } from '@nestjs/testing';
import { buttonPress, PROPOSAL_ID, TELEGRAM_CONFIG } from '../../../../test/fixtures/telegram';
import { appConfig } from '../../../config/app.config';
import { WebhookReceipt } from '../../../generated/prisma/client';
import { WebhookReceiptStatus } from '../../../generated/prisma/enums';
import { TelegramCallResult, TelegramClient } from '../../../telegram/telegram.client';
import { telegramConfig } from '../../../telegram/telegram.config';
import { textsOf } from '../../../texts/texts';
import { WebhookReceiptRepository } from '../../receipts/webhook-receipt.repository';
import { WebhookReceipts } from '../../receipts/webhook-receipts';
import { ChannelIntent } from '../channel-intent';
import { IntentOutcome, IntentRouter } from '../intent.router';
import { TelegramUpdate } from './telegram-update.schema';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { Acknowledgement, TelegramInbound } from './telegram.inbound';

/** A shared call log: the order is part of the claim. */
const calls: string[] = [];

/** Builds a full receipt row rather than part of one, so a new field breaks compilation here. */
function receiptRow(externalId: string): WebhookReceipt {
  return {
    id: `receipt-${externalId}`,
    source: 'telegram',
    externalId,
    eventType: 'callback_query',
    entityId: null,
    pageId: null,
    attemptNumber: null,
    diagnostics: {},
    receivedAt: new Date(),
    processedAt: null,
    status: 'received',
    lastError: null,
  };
}

/** What the stub store recorded: the row, the status and the reason. */
interface Settled {
  readonly id: string;
  readonly status: WebhookReceiptStatus;
  readonly reason?: string;
}

/**
 * A stub repository that **decides nothing**.
 *
 * The deduplication rule lives in the real repository and is checked against it
 * (`test/integration/telegram-intake.spec.ts`): it returns `null` only for `processed`/`rejected`,
 * and returns a row in `received` or `failed` so that the provider's redelivery finishes what was
 * left unfinished. A fake that decided on its own would assert behavior that does not exist in
 * production. Fakes are for transport, not for our decisions.
 */
class FakeReceipts implements Pick<WebhookReceiptRepository, 'accept' | 'settle'> {
  readonly settled: Settled[] = [];
  readonly accepted: Record<string, unknown>[] = [];

  accept(event: {
    externalId: string;
    diagnostics: Record<string, unknown>;
  }): Promise<WebhookReceipt | null> {
    calls.push('receipt');
    this.accepted.push(event.diagnostics);

    return Promise.resolve(receiptRow(event.externalId));
  }

  failSettle = false;

  settle(id: string, status: WebhookReceiptStatus, reason?: string): Promise<void> {
    if (this.failSettle) return Promise.reject(new Error('database gone'));

    this.settled.push({ id, status, reason });

    return Promise.resolve();
  }
}

class FakeClient {
  failAck = false;
  failSend = false;
  /** The Bot API refused: the client returns the refusal as a value, not as an exception. */
  refuseSend = false;
  readonly acks: Acknowledgement[] = [];
  readonly sent: [string, string][] = [];

  sendMessage(chatId: string, html: string): Promise<TelegramCallResult> {
    calls.push('reply');
    this.sent.push([chatId, html]);

    if (this.failSend) return Promise.reject(new Error('network reset'));
    if (this.refuseSend) {
      return Promise.resolve({
        ok: false,
        error: 'Too Many Requests: retry after 3',
        retryAfterSeconds: 3,
      });
    }

    return Promise.resolve({ ok: true });
  }

  answerCallbackQuery(
    _callbackQueryId: string,
    text = '',
    alert = false,
  ): Promise<TelegramCallResult> {
    calls.push('ack');
    this.acks.push({ text, alert });

    if (this.failAck) return Promise.reject(new Error('network reset'));

    return Promise.resolve({ ok: true });
  }
}

/** A router with no decisions of its own: it returns the result it is given. */
class FakeRouter implements Pick<IntentRouter, 'route'> {
  outcome: IntentOutcome = { kind: 'decided', decision: 'approve' };
  failure?: Error;
  readonly routed: ChannelIntent[] = [];

  route(intent: ChannelIntent): Promise<IntentOutcome> {
    calls.push('route');
    this.routed.push(intent);

    return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.outcome);
  }
}

describe('TelegramWebhookController', () => {
  let receipts: FakeReceipts;
  let router: FakeRouter;
  let controller: TelegramWebhookController;
  let client: FakeClient;

  beforeEach(async () => {
    calls.length = 0;
    receipts = new FakeReceipts();
    router = new FakeRouter();

    client = new FakeClient();

    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramWebhookController],
      providers: [
        TelegramInbound,
        // The receipt lifecycle is real: only the store is a stub, and it decides nothing.
        WebhookReceipts,
        { provide: WebhookReceiptRepository, useValue: receipts },
        { provide: TelegramClient, useValue: client },
        { provide: IntentRouter, useValue: router },
        { provide: telegramConfig.KEY, useValue: TELEGRAM_CONFIG },
        { provide: appConfig.KEY, useValue: { ...appConfig(), language: 'uk' } },
      ],
    }).compile();

    controller = moduleRef.get(TelegramWebhookController);
  });

  const press = (updateId = 1): TelegramUpdate => buttonPress(updateId);

  /**
   * `INV-023` requires the ack before the action is **executed**. The executor executes the
   * action, and here the decision is only recorded. The ack comes after recording on purpose,
   * because it is an external call and the reverse order would lose the person's decision. An ack
   * failure would return a 500, the provider would resend the update, and deduplication would say
   * “duplicate”.
   */
  it('records the decision before the ack', async () => {
    await controller.receive(press());

    expect(calls).toEqual(['receipt', 'route', 'ack']);
  });

  it('passes the intent to the router with the proposal id', async () => {
    await controller.receive(press());

    const expected: ChannelIntent[] = [{ kind: 'approve', pendingActionId: PROPOSAL_ID }];

    expect(router.routed).toEqual(expected);
  });

  /**
   * The answer says what happened, not what was supposed to happen: pressing a button on an
   * already decided proposal does not answer “Approved”.
   */
  it('names the result in the ack, not the kind of button', async () => {
    await controller.receive(press(1));

    router.outcome = { kind: 'not_awaiting' };
    await controller.receive(press(2));

    const expected: Acknowledgement[] = [
      { text: 'Схвалено', alert: false },
      { text: 'Пропозиція вже не чекає рішення', alert: false },
    ];

    expect(client.acks).toEqual(expected);
  });

  /** A pop-up line would hide a hint that requires action before it is read to the end. */
  it('answers a snooze without a time with an alert the person closes themselves', async () => {
    router.outcome = { kind: 'needs_time' };

    await controller.receive(buttonPress(6, { data: `snooze:${PROPOSAL_ID}` }));

    const expected: Acknowledgement[] = [
      {
        text: 'До коли відкласти? Напиши відповіддю на це повідомлення',
        alert: true,
      },
    ];

    expect(client.acks).toEqual(expected);
  });

  it('answers a press whose intent is not read and records it as `rejected`', async () => {
    await controller.receive(buttonPress(5, { data: 'approve:not-a-uuid' }));

    expect(router.routed).toHaveLength(0);
    const unreadable: Acknowledgement[] = [{ text: 'Кнопку не вдалося прочитати', alert: false }];

    expect(client.acks).toEqual(unreadable);
    const settled: Settled[] = [
      { id: 'receipt-5', status: 'rejected', reason: 'update carries no intent' },
    ];

    expect(receipts.settled).toEqual(settled);
  });

  /**
   * A failure is recorded on the row and propagates: the provider gets a non-2xx and redelivers,
   * and the redelivery finishes what was left unfinished.
   */
  it('records a processing failure on the receipt with a reason', async () => {
    router.failure = new Error('database unreachable');

    await expect(controller.receive(press())).rejects.toThrow('database unreachable');
    const settled: Settled[] = [
      { id: 'receipt-1', status: 'failed', reason: 'database unreachable' },
    ];

    expect(receipts.settled).toEqual(settled);
  });

  it('does not repeat intake when the reply to text fails', async () => {
    router.outcome = {
      kind: 'unconsumed',
      reason: 'the replied message belongs to no Notion thread',
    };
    client.failSend = true;

    await expect(
      controller.receive({
        update_id: 3,
        message: {
          message_id: 9,
          chat: { id: 42 },
          text: 'так',
          reply_to_message: { message_id: 7 },
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(receipts.settled).toEqual([
      {
        id: 'receipt-3',
        status: 'rejected',
        reason: 'the replied message belongs to no Notion thread',
      },
    ]);
  });

  /** Text that went into a thread gets no reply in the channel: the person sees it in Notion. */
  it('accepted text gets no reply', async () => {
    router.outcome = { kind: 'replied' };

    await controller.receive({
      update_id: 4,
      message: {
        message_id: 10,
        chat: { id: 42 },
        text: 'так',
        reply_to_message: { message_id: 7 },
      },
    });

    expect(client.sent).toEqual([]);
  });

  /**
   * If the failure itself cannot be recorded either, neither of the two facts may be lost: the
   * error about the recording propagates, and its cause is the work failure, which is the one that
   * needs fixing.
   */
  it('does not hide the original error when a failure is not recorded', async () => {
    const failure = new Error('router is down');

    router.failure = failure;
    receipts.failSettle = true;

    const received = controller.receive(press());

    await expect(received).rejects.toThrow('recording the failure failed too: database gone');
    await expect(received).rejects.toHaveProperty('cause', failure);
  });

  /** The words went nowhere, and the person hears about it in a reply, not in silence. */
  it('rejects text not tied to a system message, with a reason and a reply', async () => {
    router.outcome = { kind: 'unconsumed', reason: 'this text answers none of the dialogue' };

    await controller.receive({
      update_id: 2,
      message: { message_id: 8, chat: { id: 42 }, text: 'ідея' },
    });

    const expected: ChannelIntent[] = [{ kind: 'unsolicited' }];

    expect(calls).toEqual(['receipt', 'route', 'reply']);
    expect(client.sent).toEqual([['42', textsOf('uk').telegram.nowhere]]);
    expect(router.routed).toEqual(expected);

    const settled: Settled[] = [
      { id: 'receipt-2', status: 'rejected', reason: 'this text answers none of the dialogue' },
    ];

    expect(receipts.settled).toEqual(settled);
  });

  /**
   * Notion is unavailable and the words went nowhere. The person is told so right away and will
   * send them later, and the receipt is rejected, because a late redelivery of the same update
   * would produce a second reply (ADR 0045).
   */
  it('words that were not recorded get a reply and are recorded as `rejected`', async () => {
    router.outcome = { kind: 'not_recorded' };

    await controller.receive({
      update_id: 5,
      message: {
        message_id: 11,
        chat: { id: 42 },
        text: 'відклади до понеділка',
        reply_to_message: { message_id: 31 },
      },
    });

    expect(calls).toEqual(['receipt', 'route', 'reply']);
    expect(client.sent).toEqual([['42', textsOf('uk').telegram.answers.notRecorded]]);

    const settled: Settled[] = [
      {
        id: 'receipt-5',
        status: 'rejected',
        reason: 'Notion is unavailable: the reply was not recorded',
      },
    ];

    expect(receipts.settled).toEqual(settled);
  });

  /**
   * The person did not hear that the words were not recorded, so the provider's redelivery has a
   * chance to record them or to say so.
   */
  it('fails the receipt for unrecorded words the person could not be told about', async () => {
    router.outcome = { kind: 'not_recorded' };
    client.failSend = true;

    await expect(
      controller.receive({
        update_id: 6,
        message: {
          message_id: 12,
          chat: { id: 42 },
          text: 'відклади до понеділка',
          reply_to_message: { message_id: 31 },
        },
      }),
    ).rejects.toThrow('network reset');

    const settled: Settled[] = [{ id: 'receipt-6', status: 'failed', reason: 'network reset' }];

    expect(receipts.settled).toEqual(settled);
  });

  /**
   * A Bot API refusal also counts as “not told”: a 429 or 5xx arrives as a value, not as an
   * exception.
   */
  it('fails the receipt for unrecorded words whose reply the Bot API rejected', async () => {
    router.outcome = { kind: 'not_recorded' };
    client.refuseSend = true;

    await expect(
      controller.receive({
        update_id: 7,
        message: {
          message_id: 13,
          chat: { id: 42 },
          text: 'відклади до понеділка',
          reply_to_message: { message_id: 31 },
        },
      }),
    ).rejects.toThrow('the not-recorded answer was refused: Too Many Requests: retry after 3');

    const settled: Settled[] = [
      {
        id: 'receipt-7',
        status: 'failed',
        reason: 'the not-recorded answer was refused: Too Many Requests: retry after 3',
      },
    ];

    expect(receipts.settled).toEqual(settled);
  });

  it('accepts a reply to a system message and records it as `processed`', async () => {
    router.outcome = { kind: 'replied' };

    await controller.receive({
      update_id: 4,
      message: {
        message_id: 9,
        chat: { id: 42 },
        text: 'відклади до понеділка',
        reply_to_message: { message_id: 31 },
      },
    });

    expect(router.routed).toEqual([
      {
        kind: 'reply',
        repliedTo: '31',
        text: 'відклади до понеділка',
        channel: 'telegram',
        eventId: 'telegram:4',
      },
    ]);
    expect(receipts.settled).toEqual([{ id: 'receipt-4', status: 'processed', reason: undefined }]);
  });

  it('records an update with no intent as `rejected`', async () => {
    await controller.receive({ update_id: 3, message: { message_id: 9, chat: { id: 42 } } });

    expect(router.routed).toHaveLength(0);
    const settled: Settled[] = [
      { id: 'receipt-3', status: 'rejected', reason: 'update carries no intent' },
    ];

    expect(receipts.settled).toEqual(settled);
  });

  it('records a handled update as `processed`', async () => {
    await controller.receive(press());

    const settled: Settled[] = [{ id: 'receipt-1', status: 'processed', reason: undefined }];

    expect(receipts.settled).toEqual(settled);
  });

  /**
   * The ack is cosmetic: the decision is already recorded and will run without it. An ack failure
   * that failed the processing would return a 500, the provider would resend the update,
   * deduplication would say “duplicate”, and the pressed “Approve” would leave nothing behind.
   */
  it('does not lose the decision or fail the processing when the ack fails', async () => {
    client.failAck = true;

    await expect(controller.receive(press())).resolves.toEqual({ ok: true });

    expect(router.routed).toHaveLength(1);
    const settled: Settled[] = [{ id: 'receipt-1', status: 'processed', reason: undefined }];

    expect(receipts.settled).toEqual(settled);
  });

  /**
   * The text the person typed to the bot does not reach the technical table, because diagnostics
   * need the intent and the addressee, not the content.
   */
  it('does not store the message text in the receipt', async () => {
    await controller.receive({
      update_id: 4,
      message: { message_id: 10, chat: { id: 42 }, text: 'особиста нотатка' },
    });

    const [diagnostics] = receipts.accepted;

    expect(JSON.stringify(diagnostics)).not.toContain('особиста нотатка');
    expect(diagnostics).toEqual({
      callback_data: undefined,
      message_id: 10,
      has_text: true,
    });
  });
});
