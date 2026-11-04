import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { minutesToMilliseconds } from 'date-fns';
import { appConfig } from '../../src/config/app.config';
import { throttleConfig, WEBHOOK_THROTTLE } from '../../src/config/throttle.config';
import { ChannelIntent } from '../../src/intake/channel/channel-intent';
import { IntentOutcome, IntentRouter } from '../../src/intake/channel/intent.router';
import { TelegramWebhookController } from '../../src/intake/channel/telegram/telegram-webhook.controller';
import { TelegramInbound } from '../../src/intake/channel/telegram/telegram.inbound';
import { WebhookReceiptRepository } from '../../src/intake/receipts/webhook-receipt.repository';
import { WebhookReceipts } from '../../src/intake/receipts/webhook-receipts';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { TelegramClient } from '../../src/telegram/telegram.client';
import { telegramConfig } from '../../src/telegram/telegram.config';
import { buttonPress, TELEGRAM_CONFIG } from '../fixtures/telegram';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

/** A router with no decisions of its own. It remembers the intent and, when told to, fails. */
class RecordingRouter implements Pick<IntentRouter, 'route'> {
  readonly routed: ChannelIntent[] = [];
  fail = false;

  route(intent: ChannelIntent): Promise<IntentOutcome> {
    this.routed.push(intent);

    return this.fail
      ? Promise.reject(new Error('router is down'))
      : Promise.resolve({ kind: 'decided', decision: 'approve' });
  }
}

/** The transport is a legitimate thing to stub: it makes no decisions. */
const client: Pick<TelegramClient, 'answerCallbackQuery'> = {
  answerCallbackQuery: () => Promise.resolve({ ok: true }),
};

/**
 * Deduplication of button presses runs against the **real** receipt store.
 *
 * The deduplication rule lives in the store, and a stub store that decides on its own would
 * assert behavior that production does not have. The real one returns `null` only for
 * `processed` and `rejected`: a row whose processing failed stays `failed` with a reason, and
 * the provider's redelivery must finish it.
 */
describe('intake of Telegram button presses', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let controller: TelegramWebhookController;
  let router: RecordingRouter;

  beforeAll(async () => {
    router = new RecordingRouter();

    moduleRef = await Test.createTestingModule({
      imports: [
        // The database address comes from the environment of the test run; the App language is
        // the one it replies in.
        testConfig(databaseConfig, appConfig),
        ThrottlerModule.forRoot([
          {
            name: WEBHOOK_THROTTLE,
            ttl: minutesToMilliseconds(1),
            limit: throttleConfig().webhooksPerMinute,
          },
        ]),
      ],
      controllers: [TelegramWebhookController],
      providers: [
        PrismaService,
        WebhookReceiptRepository,
        WebhookReceipts,
        TelegramInbound,
        { provide: IntentRouter, useValue: router },
        { provide: TelegramClient, useValue: client },
        { provide: telegramConfig.KEY, useValue: TELEGRAM_CONFIG },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(TelegramWebhookController);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    router.routed.length = 0;
    router.fail = false;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('a duplicate of a processed update has no second effect', async () => {
    await controller.receive(buttonPress(1));

    await expect(controller.receive(buttonPress(1))).resolves.toEqual({ ok: true });

    expect(router.routed).toHaveLength(1);
    await expect(prisma.webhookReceipt.count()).resolves.toBe(1);
  });

  /** A rejected update is settled too: a duplicate does not reopen it. */
  it('a duplicate of a rejected update has no second effect', async () => {
    const empty = { update_id: 3, message: { message_id: 9, chat: { id: 42 } } };

    await controller.receive(empty);
    await controller.receive(empty);

    const receipt = await prisma.webhookReceipt.findFirstOrThrow();

    expect(receipt.status).toBe('rejected');
    expect(receipt.lastError).toBe('update carries no intent');
    expect(router.routed).toHaveLength(0);
  });

  /**
   * Processing failed, and the row stays `failed` with a reason, that is, unsettled. The
   * provider's redelivery must finish it. If deduplication followed the bare fact “this id was
   * seen”, the “Approve” the person pressed would vanish forever after one transient error.
   */
  it('a redelivery after a failed processing finishes it instead of staying silent', async () => {
    router.fail = true;

    await expect(controller.receive(buttonPress(2))).rejects.toThrow('router is down');

    const afterFailure = await prisma.webhookReceipt.findFirstOrThrow();

    expect(afterFailure.status).toBe('failed');
    expect(afterFailure.lastError).toBe('router is down');
    expect(afterFailure.processedAt).toBeNull();

    router.fail = false;

    await expect(controller.receive(buttonPress(2))).resolves.toEqual({ ok: true });

    expect(router.routed).toHaveLength(2);
    await expect(prisma.webhookReceipt.findFirstOrThrow().then((row) => row.status)).resolves.toBe(
      'processed',
    );
  });
});
