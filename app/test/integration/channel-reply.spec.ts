import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getUnixTime, minutesToMilliseconds } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { AttentionService } from '../../src/attention/attention.service';
import { appConfig } from '../../src/config/app.config';
import { throttleConfig, WEBHOOK_THROTTLE } from '../../src/config/throttle.config';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { outboxConfig } from '../../src/delivery/outbox/outbox.config';
import { OutboxRepository } from '../../src/delivery/outbox/outbox.repository';
import { QuietHours } from '../../src/delivery/outbox/quiet-hours';
import { quietHoursConfig } from '../../src/delivery/outbox/quiet-hours.config';
import { NOTIFICATION_CHANNELS } from '../../src/delivery/port/channel.port';
import { ChannelRegistry } from '../../src/delivery/port/channel.registry';
import { CHANNEL_MESSAGE_EVENT, ChannelReply } from '../../src/intake/channel/channel-reply';
import { IntentRouter } from '../../src/intake/channel/intent.router';
import { TelegramWebhookController } from '../../src/intake/channel/telegram/telegram-webhook.controller';
import { TelegramInbound } from '../../src/intake/channel/telegram/telegram.inbound';
import { EvaluationWindowRepository } from '../../src/intake/notion/evaluation-window.repository';
import { WebhookReceiptRepository } from '../../src/intake/receipts/webhook-receipt.repository';
import { WebhookReceipts } from '../../src/intake/receipts/webhook-receipts';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { Actor } from '../../src/runs/actor';
import { TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { TelegramClient } from '../../src/telegram/telegram.client';
import { telegramConfig } from '../../src/telegram/telegram.config';
import { PAGE } from '../fixtures/channel-reply-world';
import { TELEGRAM_CONFIG } from '../fixtures/telegram';
import { testConfig } from '../fixtures/test-module';
import { buildIntakeHarness, IntakeHarness } from './intake.harness';

/** A conversation: the system commented in the thread from a `dialogue` run. */
const TALKING: Actor = {
  kind: 'run',
  runId: 'run-2',
  mode: 'dialogue',
  provenance: { origin: 'channel_inbound' },
  startedAt: new Date(),
};

const CHAT_OF_PERSON = { id: 42 };
const MESSAGE = 31;
const WORDS = 'відклади до понеділка';

/** Builds an update with text, the way Telegram sends it. */
function textUpdate(updateId: number, text: string, repliedTo?: number): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: 100 + updateId,
      chat: CHAT_OF_PERSON,
      text,
      date: getUnixTime(new Date()),
      ...(repliedTo === undefined ? {} : { reply_to_message: { message_id: repliedTo } }),
    },
  };
}

/**
 * A person's reply to a system message, against real receipts, windows, the delivery queue and
 * attention over the database, from the update to the run candidate.
 *
 * The channel serves a dialogue that the system started, so it accepts no new words from the
 * person: text that does not reply to a system message is rejected with a reason.
 */
describe("a person's channel reply", () => {
  let harness: IntakeHarness;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let controller: TelegramWebhookController;

  beforeAll(async () => {
    harness = await buildIntakeHarness();

    moduleRef = await Test.createTestingModule({
      imports: [
        testConfig(databaseConfig, appConfig, outboxConfig),
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
        IntentRouter,
        ChannelReply,
        DeliveryService,
        OutboxRepository,
        QuietHours,
        ChannelRegistry,
        {
          provide: quietHoursConfig.KEY,
          useValue: { enabled: false, startMinute: 0, endMinute: 0 },
        },
        { provide: NOTIFICATION_CHANNELS, useValue: [] },
        { provide: EvaluationWindowRepository, useValue: harness.windows },
        { provide: ApprovalsService, useValue: {} },
        { provide: TelegramClient, useValue: {} },
        { provide: telegramConfig.KEY, useValue: TELEGRAM_CONFIG },
        // Attention is real, over the same Notion and the same database as the windows.
        { provide: AttentionService, useValue: harness.attention },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(TelegramWebhookController);
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await moduleRef.close();
    await harness.close();
  });

  /**
   * The system commented in a thread and sent a message about it. The message id is in the
   * outbox.
   */
  const sentAbout = async (discussionId: string | null): Promise<void> => {
    await prisma.notificationOutbox.create({
      data: {
        idempotencyKey: `nudge-${MESSAGE}`,
        channel: 'telegram',
        discussionId,
        externalId: String(MESSAGE),
        payload: {},
        status: 'sent',
        sentAt: new Date(),
      },
    });
  };

  const thread = async (): Promise<string> =>
    (
      await harness.attention.comment(TALKING, {
        pageId: PAGE,
        text: 'Задача чекає на відповідь постачальника вже тиждень',
      })
    ).discussionId;

  const envelopeOfRipe = async (): Promise<TriggerEnvelope> => {
    const [candidate] = await harness.ripe();
    const claimed = candidate && (await harness.windowRuns.claim(candidate.id));

    if (!claimed) throw new Error('no ripe window to claim');

    return claimed.request.envelope;
  };

  it("the words are written to the thread, and the window is a run for the person's words in the mode in which the system managed the thread", async () => {
    const discussionId = await thread();

    await sentAbout(discussionId);
    harness.notion.reset();

    await controller.receive(textUpdate(5, WORDS, MESSAGE));

    const quoted = harness.notion.created.map((params) => JSON.stringify(params));

    expect(quoted).toHaveLength(1);
    expect(quoted[0]).toContain(WORDS);
    expect(quoted[0]).toContain(discussionId);

    await expect(prisma.evaluationWindow.findFirstOrThrow()).resolves.toMatchObject({
      discussionId,
      personReplied: true,
      channelInbound: true,
      inboxItemCreated: false,
      latestEventId: 'telegram:5',
      latestEventType: CHANNEL_MESSAGE_EVENT,
    });

    const candidates = await harness.ripe();

    expect(candidates.map((candidate) => candidate.provenance)).toEqual([
      { origin: 'channel_inbound' },
    ]);
  });

  /** `INV-030`: the envelope has the origin and identifiers; the person's words live in Notion. */
  it('the envelope contains the thread and the mode in which it was managed, and no words', async () => {
    const discussionId = await thread();

    await sentAbout(discussionId);
    await controller.receive(textUpdate(6, WORDS, MESSAGE));

    const envelope = await envelopeOfRipe();

    expect(envelope).toMatchObject({
      mode: 'dialogue',
      trigger: {
        type: CHANNEL_MESSAGE_EVENT,
        event_id: 'telegram:6',
        discussion_id: discussionId,
      },
    });
    expect(JSON.stringify(envelope)).not.toContain(WORDS);
    expect(JSON.stringify(await prisma.evaluationWindow.findMany())).not.toContain(WORDS);
    expect(JSON.stringify(await prisma.webhookReceipt.findMany())).not.toContain(WORDS);
  });

  it('a redelivery does not write a second comment', async () => {
    const discussionId = await thread();

    await sentAbout(discussionId);
    harness.notion.reset();
    await controller.receive(textUpdate(7, WORDS, MESSAGE));
    await controller.receive(textUpdate(7, WORDS, MESSAGE));

    expect(harness.notion.created).toHaveLength(1);
  });

  /** The channel accepts no new words from the person: no Inbox item, no comment, no window. */
  describe('what the channel does not accept', () => {
    const nothingWritten = async (): Promise<void> => {
      expect(harness.notion.sent).toEqual([]);
      await expect(prisma.evaluationWindow.count()).resolves.toBe(0);
    };

    it('text that does not reply to a system message is rejected with a reason', async () => {
      harness.notion.reset();

      await controller.receive(textUpdate(8, 'зателефонувати лікарю'));

      await expect(prisma.webhookReceipt.findFirstOrThrow()).resolves.toMatchObject({
        status: 'rejected',
        lastError: expect.stringContaining('answers none of it'),
      });
      await nothingWritten();
    });

    it.each([
      ['the message is unknown', (): Promise<void> => Promise.resolve()],
      ['the message is not about a thread', () => sentAbout(null)],
    ])('a reply is rejected with a reason when %s', async (_case, arrange) => {
      await arrange();
      harness.notion.reset();

      await controller.receive(textUpdate(9, 'зателефонувати лікарю', MESSAGE));

      await expect(prisma.webhookReceipt.findFirstOrThrow()).resolves.toMatchObject({
        status: 'rejected',
        lastError: expect.stringContaining('belongs to no Notion thread'),
      });
      await nothingWritten();
    });
  });
});
