import { Test } from '@nestjs/testing';
import { NOTICED } from '../../test/fixtures/actors';
import { QUEUED } from '../../test/fixtures/queued-delivery';
import { appConfig } from '../config/app.config';
import { NotificationOutbox } from '../generated/prisma/client';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { Actor, CHAT } from '../runs/actor';
import type { NotionWait } from '../runs/notion-wait-notice';
import { textsOf } from '../texts/texts';
import { excessOf } from './channels/telegram/telegram.renderer';
import { DeliveryRequest, deliverySchema } from './delivery.schema';
import { DeliveryService, ProposalLookup } from './delivery.service';
import { DeliveryAbsentWire, DeliveryStateWire } from './delivery.wire';
import { OutboxRepository, QueuedDelivery } from './outbox/outbox.repository';
import { QuietHours } from './outbox/quiet-hours';
import { DeliveryReceipt, NotificationChannel, OutboundMessage } from './port/channel.port';
import { ChannelRegistry } from './port/channel.registry';

const REQUEST: DeliveryRequest = {
  idempotencyKey: 'nudge-1',
  channel: 'telegram',
  message: {
    noticed: 'Задача чекає на відповідь постачальника',
    whyItMatters: 'Вона блокує єдиний критичний шлях проєкту',
    ask: 'Підготувати ескалацію?',
    link: 'https://www.notion.so/page-1',
  },
};

/** A proposal that still awaits a decision, and one that no longer does. */
const OPEN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CLOSED = '9b2d5c1e-3f4a-4b6c-8d7e-1a2b3c4d5e6f';
const QUEUED_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const FOURTH_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';

const OPEN_PROPOSALS: ProposalLookup = {
  awaitsDecision: (id) => Promise.resolve(id === OPEN),
  waitingBesides: () => Promise.resolve(0),
};

/** The person's reply in the channel: the origin is exempt. */
const ASKED: Actor = {
  kind: 'run',
  runId: 'run-1',
  mode: 'dialogue',
  provenance: { origin: 'channel_inbound' },
  startedAt: new Date('2026-09-28T09:00:00.000Z'),
};

interface DeliveryHarness {
  readonly service: DeliveryService;
  readonly queued: QueuedDelivery[];
  readonly channel: EditingChannel;
}

/** A channel that edits messages and remembers what it was told to do. */
class EditingChannel implements NotificationChannel {
  readonly id = 'telegram';
  readonly capabilities = { interactiveActions: true };
  readonly edits: [string, OutboundMessage, ReadonlyMap<string, string>][] = [];
  receipt: DeliveryReceipt = { ok: true };
  failure?: Error;
  /**
   * By how much the packet is longer than a message: a test makes the channel tight by changing
   * this field.
   */
  over = 0;

  excess(): number {
    return this.over;
  }

  send(): Promise<DeliveryReceipt> {
    return Promise.resolve({ ok: true });
  }

  edit(
    externalId: string,
    message: OutboundMessage,
    settled: ReadonlyMap<string, string>,
  ): Promise<DeliveryReceipt> {
    this.edits.push([externalId, message, settled]);

    return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.receipt);
  }
}

/** A channel that cannot edit: it has no `edit` method. */
class PlainChannel implements NotificationChannel {
  readonly id = 'telegram';
  readonly capabilities = { interactiveActions: false };

  excess(): number {
    return 0;
  }

  send(): Promise<DeliveryReceipt> {
    return Promise.resolve({ ok: true });
  }
}

/** Builds a proposal of the packet: an id and a line. */
const line = (pendingActionId: string): { pendingActionId: string; line: string } => ({
  pendingActionId,
  line: 'Перевести задачу в Next Action',
});

/** A sent message about the proposal `OPEN`: its id in the channel, the thread and the packet. */
const SENT: NotificationOutbox = {
  ...QUEUED,
  id: 'row-sent',
  idempotencyKey: 'event:review:daily_control:2026-10-15',
  discussionId: '5b6a4978-8a9b-4c1d-9e2f-3a4b5c6d7e8f',
  externalId: '31',
  status: 'sent',
  payload: { ...REQUEST.message, proposals: [line(OPEN)] },
};

/** Quiet hours last until eight in the morning. */
const SILENT_UNTIL = new Date('2026-09-28T05:00:00.000Z');

/**
 * Builds a service over a queue that only remembers what was enqueued, and over quiet hours that
 * are currently in progress. The decisions are made before the queue.
 */
async function deliveryOver(
  channel: NotificationChannel = new EditingChannel(),
  sent: readonly NotificationOutbox[] = [SENT],
): Promise<DeliveryHarness> {
  const queued: QueuedDelivery[] = [];
  const outbox: Pick<
    OutboxRepository,
    'enqueue' | 'find' | 'findSent' | 'sentFor' | 'settle' | 'shownWithKeyPrefix'
  > = {
    settle: (_id, pendingActionId, fate) => Promise.resolve(new Map([[pendingActionId, fate]])),
    // The packet with a proposal in these fixtures has only `OPEN`.
    shownWithKeyPrefix: (prefix) =>
      Promise.resolve(
        sent
          .filter((row) => row.idempotencyKey.startsWith(prefix) && row.id === SENT.id)
          .map(() => OPEN),
      ),
    findSent: (via, externalId) =>
      Promise.resolve(
        sent.find((row) => row.channel === via && row.externalId === externalId) ?? null,
      ),
    sentFor: (pendingActionId) =>
      Promise.resolve(sent.filter((row) => JSON.stringify(row.payload).includes(pendingActionId))),
    enqueue: (delivery) => {
      queued.push(delivery);

      return Promise.resolve(QUEUED);
    },
    find: (key) => Promise.resolve(key === QUEUED.idempotencyKey ? QUEUED : null),
  };
  const quiet: Pick<QuietHours, 'silentUntil'> = { silentUntil: () => SILENT_UNTIL };

  const moduleRef = await Test.createTestingModule({
    providers: [
      DeliveryService,
      { provide: OutboxRepository, useValue: outbox },
      { provide: QuietHours, useValue: quiet },
      { provide: ChannelRegistry, useValue: new ChannelRegistry([channel]) },
      { provide: appConfig.KEY, useValue: { ...appConfig(), language: 'uk' } },
    ],
  }).compile();

  return {
    service: moduleRef.get(DeliveryService),
    queued,
    channel: channel instanceof EditingChannel ? channel : new EditingChannel(),
  };
}

describe('delivery as a capability', () => {
  it('breaks through quiet hours for what the person asked for, as decided by whoever acts', async () => {
    const { service, queued } = await deliveryOver();

    await service.enqueue(ASKED, REQUEST, OPEN_PROPOSALS);
    await service.enqueue(NOTICED, REQUEST, OPEN_PROPOSALS);
    await service.enqueue(CHAT, REQUEST, OPEN_PROPOSALS);

    const expected: boolean[] = [true, false, true];

    expect(queued.map((delivery) => delivery.quietHoursExempt)).toEqual(expected);
  });

  /**
   * The App MCP transport passes on a request composed by the model. A field the request shape
   * does not have gets a refusal: silently dropped, it would leave the caller sure that quiet hours
   * were lifted for it.
   */
  it('an exemption passed along with the request gets a refusal, not silence', async () => {
    const { service, queued } = await deliveryOver();
    const smuggled: DeliveryRequest & { readonly quietHoursExempt: boolean } = {
      ...REQUEST,
      quietHoursExempt: true,
    };

    await expect(service.enqueue(NOTICED, smuggled, OPEN_PROPOSALS)).rejects.toThrow(
      InvalidRequestError,
    );
    expect(queued).toHaveLength(0);
  });

  /**
   * Types would not let a request with a channel outside the adapters through, but the transport
   * reads JSON, not types: the schema enforces the limit, and it is tested on the same untyped
   * input.
   */
  it('the schema refuses a channel that is not among the adapters', () => {
    const misspelt: Record<string, unknown> = { ...REQUEST, channel: 'telegarm' };

    expect(deliverySchema.safeParse(misspelt).success).toBe(false);
    expect(deliverySchema.safeParse({ ...misspelt, channel: 'telegram' }).success).toBe(true);
  });

  /**
   * A proposal id is a uuid, like all proposal ids: otherwise a button's `kind:id` might not fit
   * into the 64 bytes of `callback_data`, and Telegram would reject the message.
   */
  it('refuses proposals with an id that is not a uuid before the queue', async () => {
    const { service, queued } = await deliveryOver();
    const proposing: DeliveryRequest = {
      ...REQUEST,
      message: { ...REQUEST.message, proposals: [line('pa-1')] },
    };

    await expect(service.enqueue(ASKED, proposing, OPEN_PROPOSALS)).rejects.toThrow(
      InvalidRequestError,
    );
    expect(queued).toHaveLength(0);
  });

  it('refuses more than three proposals, or the same one twice, before the queue', async () => {
    const { service, queued } = await deliveryOver();
    const ids = [OPEN, CLOSED, QUEUED_ID, FOURTH_ID];

    for (const proposals of [ids.map(line), [line(OPEN), line(OPEN)]]) {
      await expect(
        service.enqueue(
          ASKED,
          { ...REQUEST, message: { ...REQUEST.message, proposals } },
          OPEN_PROPOSALS,
        ),
      ).rejects.toThrow(InvalidRequestError);
    }

    expect(queued).toHaveLength(0);
  });

  /** The refusal says by how much to shorten: the run fixes the packet instead of guessing. */
  it('refuses a packet that does not fit the channel message before the queue, with the excess', async () => {
    const { service, queued, channel } = await deliveryOver();

    channel.over = 312;

    await expect(service.enqueue(ASKED, REQUEST, OPEN_PROPOSALS)).rejects.toThrow(
      'the packet is 312 characters longer than one telegram message',
    );
    expect(queued).toHaveLength(0);
  });

  /**
   * Telegram's own measure, not a fake: a long body is refused, and the refusal states that same
   * measure.
   */
  it('refuses a body longer than a Telegram message, with its excess', async () => {
    const telegram: NotificationChannel = {
      id: 'telegram',
      capabilities: { interactiveActions: true },
      excess: (message) => excessOf(message, textsOf('uk').telegram),
      send: () => Promise.resolve({ ok: true }),
    };
    const { service, queued } = await deliveryOver(telegram);
    const long: DeliveryRequest = {
      ...REQUEST,
      message: { ...REQUEST.message, noticed: 'н'.repeat(5_000) },
    };
    const excess = excessOf(long.message, textsOf('uk').telegram);

    await expect(service.enqueue(ASKED, long, OPEN_PROPOSALS)).rejects.toThrow(
      `the packet is ${excess} characters longer than one telegram message`,
    );
    await expect(service.enqueue(ASKED, REQUEST, OPEN_PROPOSALS)).resolves.toBeDefined();
    expect(queued).toHaveLength(1);
  });

  /** The App, not the model, counts how many more await a decision outside the packet. */
  describe('the rest of the proposals', () => {
    it('a packet with proposals includes the number of the rest that await a decision', async () => {
      const { service, queued } = await deliveryOver();
      const asked: (readonly string[])[] = [];
      const lookup: ProposalLookup = {
        ...OPEN_PROPOSALS,
        waitingBesides: (ids) => {
          asked.push(ids);

          return Promise.resolve(4);
        },
      };

      await service.enqueue(
        ASKED,
        { ...REQUEST, message: { ...REQUEST.message, proposals: [line(OPEN)] } },
        lookup,
      );

      expect(asked).toEqual([[OPEN]]);
      expect(queued.map((delivery) => delivery.message.moreProposals)).toEqual([4]);
    });

    it('has no number when there is no rest', async () => {
      const { service, queued } = await deliveryOver();

      await service.enqueue(
        ASKED,
        { ...REQUEST, message: { ...REQUEST.message, proposals: [line(OPEN)] } },
        OPEN_PROPOSALS,
      );

      expect(queued[0]?.message).not.toHaveProperty('moreProposals');
    });

    it('says nothing about the rest in a packet without proposals and does not ask approvals', async () => {
      const { service, queued } = await deliveryOver();
      const lookup: ProposalLookup = {
        ...OPEN_PROPOSALS,
        waitingBesides: () => Promise.reject(new Error('the count was not expected')),
      };

      await service.enqueue(ASKED, REQUEST, lookup);

      expect(queued[0]?.message).not.toHaveProperty('moreProposals');
    });

    it('refuses the number of the rest in the request, because the App counts it', () => {
      const smuggled = { ...REQUEST, message: { ...REQUEST.message, moreProposals: 2 } };

      expect(deliverySchema.safeParse(smuggled).success).toBe(false);
    });
  });

  it('never queues a packet that fails the port schema', async () => {
    const { service, queued } = await deliveryOver();
    const unanswerable: DeliveryRequest = {
      ...REQUEST,
      message: { ...REQUEST.message, ask: 'Чи варто '.repeat(40) },
    };
    const script: DeliveryRequest = {
      ...REQUEST,
      message: { ...REQUEST.message, link: 'javascript:alert(1)' },
    };

    await expect(service.enqueue(ASKED, unanswerable, OPEN_PROPOSALS)).rejects.toThrow(
      InvalidRequestError,
    );
    await expect(service.enqueue(ASKED, script, OPEN_PROPOSALS)).rejects.toThrow(
      InvalidRequestError,
    );
    expect(queued).toHaveLength(0);
  });

  /**
   * `INV-030`: the status and the time sent are included; attempts and the failure reason are not.
   */
  it('returns the delivery state as the status and the time, without queue bookkeeping', async () => {
    const { service } = await deliveryOver();
    const queued: DeliveryStateWire = { idempotency_key: 'nudge-1', status: 'pending' };
    const absent: DeliveryAbsentWire = { idempotency_key: 'absent', found: false };

    await expect(service.state('nudge-1')).resolves.toEqual(queued);
    await expect(service.state('absent')).resolves.toEqual(absent);
  });

  /** What this run enqueued is shown in the same form as a queue row. */
  it('reports a delivery enqueued by the run as staged', async () => {
    const { service } = await deliveryOver();
    const staged: DeliveryRequest = { ...REQUEST, idempotencyKey: 'nudge-2' };
    const expected: DeliveryStateWire = { idempotency_key: 'nudge-2', status: 'staged' };

    await expect(service.state('nudge-2', [staged])).resolves.toEqual(expected);
  });

  it('the delivery window says when what is enqueued at this time will be sent', async () => {
    const { service } = await deliveryOver();

    expect(service.window(ASKED)).toEqual({ quiet_hours_exempt: true });
    expect(service.window(NOTICED)).toEqual({
      quiet_hours_exempt: false,
      silent_until: SILENT_UNTIL.toISOString(),
    });
  });

  it('a check without enqueueing refuses on the same grounds as enqueueing', async () => {
    const { service, queued } = await deliveryOver();

    await expect(service.check(REQUEST, OPEN_PROPOSALS)).resolves.toMatchObject({
      idempotencyKey: 'nudge-1',
    });
    await expect(
      service.check(
        { ...REQUEST, message: { ...REQUEST.message, link: 'http://x' } },
        OPEN_PROPOSALS,
      ),
    ).rejects.toThrow(InvalidRequestError);
    expect(queued).toHaveLength(0);
  });

  /**
   * The thread has the same form as in a continuation and the system's registry: otherwise a
   * delivery about the same thread would point to another thread.
   */
  it('normalizes the delivery thread to one form', async () => {
    const { service } = await deliveryOver();
    const thread = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

    await expect(
      service.check(
        { ...REQUEST, discussionId: thread.replaceAll('-', '').toUpperCase() },
        OPEN_PROPOSALS,
      ),
    ).resolves.toMatchObject({ discussionId: thread });
  });

  /** A button with nothing behind it never reaches the person. */
  it("requires a proposal in the packet to await the person's decision", async () => {
    const { service } = await deliveryOver();
    const proposing: DeliveryRequest = {
      ...REQUEST,
      message: { ...REQUEST.message, proposals: [line(OPEN)] },
    };
    const dangling: DeliveryRequest = {
      ...REQUEST,
      message: { ...REQUEST.message, proposals: [line(CLOSED)] },
    };

    await expect(service.check(proposing, OPEN_PROPOSALS)).resolves.toMatchObject({
      idempotencyKey: 'nudge-1',
    });
    await expect(service.check(dangling, OPEN_PROPOSALS)).rejects.toThrow(
      'does not await the person',
    );
  });

  /** The proposals the person saw as buttons come from the sent packets of the named cause. */
  it('takes the shown proposals from the sent packets of the cause', async () => {
    const { service } = await deliveryOver();

    await expect(service.proposalsShown('review:daily_control:')).resolves.toEqual([OPEN]);
    await expect(service.proposalsShown('review:weekly_control_review:')).resolves.toEqual([]);
  });

  /**
   * The system speaks and the person did not ask: it respects quiet hours, and the key comes
   * from the opening.
   */
  it('enqueues the breaker notification with the opening key, without breaking through quiet hours', async () => {
    const { service, queued } = await deliveryOver();

    await service.breakerOpened({
      lastFailedRunId: 'run-9',
      reason: 'needs-auth',
      pageId: null,
      failures: 5,
    });

    expect(queued.map((delivery) => [delivery.idempotencyKey, delivery.quietHoursExempt])).toEqual([
      ['breaker:run-9', false],
    ]);
  });

  /**
   * The person replied in the channel and awaits an answer: the notice that Notion is unavailable
   * breaks through quiet hours, and the key is the window, so the queue does not duplicate a
   * second wait of the same window (ADR 0045).
   */
  describe("the person's reply that waits for Notion", () => {
    const THREAD = '5b6a4978-8a9b-4c1d-9e2f-3a4b5c6d7e8f';
    const WAIT: NotionWait = {
      windowId: 'window-1',
      discussionId: THREAD,
      pageId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
    };
    const texts = textsOf('uk').notices.notionWait;

    it('sends one notice with the window key through quiet hours while the window waits', async () => {
      const { service, queued } = await deliveryOver();

      await service.notionWaiting(WAIT);

      const expected: QueuedDelivery[] = [
        {
          idempotencyKey: 'notion-wait:window-1',
          channel: 'telegram',
          discussionId: THREAD,
          message: {
            noticed: texts.waiting.noticed,
            whyItMatters: texts.waiting.whyItMatters,
            ask: texts.waiting.ask,
            link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
          },
          quietHoursExempt: true,
        },
      ];

      expect(queued).toEqual(expected);
    });

    it('sends its own notice with its own key through quiet hours when the window no longer waits', async () => {
      const { service, queued } = await deliveryOver();

      await service.notionGaveUp(WAIT);

      const expected: QueuedDelivery[] = [
        {
          idempotencyKey: 'notion-gave-up:window-1',
          channel: 'telegram',
          discussionId: THREAD,
          message: {
            noticed: texts.gaveUp.noticed,
            whyItMatters: texts.gaveUp.whyItMatters,
            ask: texts.gaveUp.ask,
            link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
          },
          quietHoursExempt: true,
        },
      ];

      expect(queued).toEqual(expected);
    });

    /**
     * The queue drops duplicates by key, so this test checks that a repeated wait produces the
     * same key.
     */
    it('produces the same key for a repeated wait of the same window', async () => {
      const { service, queued } = await deliveryOver();

      await service.notionWaiting(WAIT);
      await service.notionWaiting(WAIT);

      expect(new Set(queued.map((delivery) => delivery.idempotencyKey))).toEqual(
        new Set(['notion-wait:window-1']),
      );
    });
  });

  /**
   * The person's reply finds the message by the id the channel reported, because the id is the
   * only link between the person's reply and the thread the message to them was about.
   */
  it('finds the thread of a sent message by the id the channel reported', async () => {
    const { service } = await deliveryOver();

    await expect(service.threadOf('telegram', '31')).resolves.toBe(SENT.discussionId);
    await expect(service.threadOf('telegram', '99')).resolves.toBeNull();
  });

  it('a reply to a message that is not about a thread continues nothing', async () => {
    const { service } = await deliveryOver(new EditingChannel(), [{ ...SENT, discussionId: null }]);

    await expect(service.threadOf('telegram', '31')).resolves.toBeNull();
  });

  /**
   * The channel removes the buttons; delivery reports which message, with which buttons, and which
   * fates are recorded in it.
   */
  it('rewrites a message about a proposal with what the proposal became', async () => {
    const { service, channel } = await deliveryOver();

    await service.showOutcome(OPEN, 'executed');

    expect(channel.edits).toEqual([
      [
        '31',
        {
          ...REQUEST.message,
          proposals: [line(OPEN)],
          actions: [
            { kind: 'approve', pendingActionId: OPEN },
            { kind: 'reject', pendingActionId: OPEN },
          ],
        },
        new Map([[OPEN, 'Виконано']]),
      ],
    ]);
  });

  it('edits nothing for a proposal with no sent message', async () => {
    const { service, channel } = await deliveryOver();

    await service.showOutcome(CLOSED, 'executed');

    expect(channel.edits).toHaveLength(0);
  });

  /**
   * The line about what happened is cosmetic: the decision is already recorded or executed, and a
   * refusal or failure of the channel must not cancel it.
   */
  it.each([
    [
      'the channel refused',
      (channel: EditingChannel) => {
        channel.receipt = { ok: false, error: 'message is not modified' };
      },
    ],
    [
      'the channel crashed',
      (channel: EditingChannel) => {
        channel.failure = new Error('network reset');
      },
    ],
  ])("%s: the proposal's fate does not change", async (_case, break_) => {
    const { service, channel } = await deliveryOver();

    break_(channel);

    await expect(service.showOutcome(OPEN, 'executed')).resolves.toBeUndefined();
  });

  /**
   * Two packets showed the proposal. A failure to edit the first does not leave the second with
   * the buttons of the settled proposal, because each message is rewritten separately.
   */
  it('does not stop the rest when one message fails', async () => {
    const other: NotificationOutbox = { ...SENT, id: 'row-other', externalId: '32' };
    const { service, channel } = await deliveryOver(new EditingChannel(), [SENT, other]);

    channel.failure = new Error('network reset');

    await service.showOutcome(OPEN, 'executed');

    expect(channel.edits.map(([externalId]) => externalId)).toEqual(['31', '32']);
  });

  it('leaves the message as it is on a channel that cannot edit', async () => {
    const { service } = await deliveryOver(new PlainChannel());

    await expect(service.showOutcome(OPEN, 'executed')).resolves.toBeUndefined();
  });
});
