import { Test, TestingModule } from '@nestjs/testing';
import { addHours, addSeconds, differenceInSeconds, subSeconds } from 'date-fns';
import { appConfig, type AppConfig } from '../../src/config/app.config';
import { DeliveryRequest } from '../../src/delivery/delivery.schema';
import { DeliveryService, ProposalLookup } from '../../src/delivery/delivery.service';
import { outboxConfig } from '../../src/delivery/outbox/outbox.config';
import { OutboxRepository } from '../../src/delivery/outbox/outbox.repository';
import { OutboxWorker } from '../../src/delivery/outbox/outbox.worker';
import { QuietHours } from '../../src/delivery/outbox/quiet-hours';
import {
  quietHoursConfig,
  type QuietHoursConfig,
} from '../../src/delivery/outbox/quiet-hours.config';
import {
  ChannelCapabilities,
  DeliveryReceipt,
  NOTIFICATION_CHANNELS,
  NotificationChannel,
  OutboundMessage,
} from '../../src/delivery/port/channel.port';
import { ChannelRegistry } from '../../src/delivery/port/channel.registry';
import { NotificationOutbox } from '../../src/generated/prisma/client';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { storedJson } from '../../src/platform/db/stored-json';
import { Leased } from '../../src/platform/queue/lease';
import { wallClock } from '../../src/platform/time/local-day';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { Actor } from '../../src/runs/actor';
import { PROPOSAL_ID } from '../fixtures/telegram';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

class ScriptedChannel implements NotificationChannel {
  readonly id = 'telegram';

  capabilities: ChannelCapabilities = {
    interactiveActions: true,
  };

  receipt: DeliveryReceipt | Error = { ok: true };
  readonly sent: OutboundMessage[] = [];

  excess(): number {
    return 0;
  }

  send(message: OutboundMessage): Promise<DeliveryReceipt> {
    this.sent.push(message);

    if (this.receipt instanceof Error) throw this.receipt;

    return Promise.resolve(this.receipt);
  }
}

/**
 * Quiet hours are set explicitly, not through environment variables: they are parsed at
 * application startup, so fiddling with `process.env` in the test would mean checking a path
 * that does not exist at runtime. The object is mutated in place because it is the object the
 * quiet-hours class takes as its config namespace.
 */
const quietHours: QuietHoursConfig = { enabled: false, startMinute: 0, endMinute: 0 };

/** The packet's proposals are open, and no proposal outside the packet awaits a decision. */
const NO_OTHERS: ProposalLookup = {
  awaitsDecision: () => Promise.resolve(true),
  waitingBesides: () => Promise.resolve(0),
};

const PACKET: OutboundMessage = {
  noticed: 'Задача стоїть у Waiting For одинадцять днів.',
  whyItMatters: 'Дедлайн через три дні.',
  ask: 'Перевести в Next Action?',
  link: 'https://notion.so/page-1',
};

/**
 * Returns the pause before the row's next attempt in seconds from the current time, or zero when
 * no time is set.
 */
function pauseOf(row: NotificationOutbox): number {
  return row.nextAttemptAt ? differenceInSeconds(row.nextAttemptAt, new Date()) : 0;
}

/**
 * `SCEN-19-33` An App restart before a notification does not lose the delivery.
 * Criterion 4 of gate M2: a logical delivery is queued once.
 *
 * The row is written **before** the first attempt to send, so a restart between enqueuing and
 * delivery does not lose it. Exactly-once on the wire does not follow from this and is not
 * checked: delivery stays at-least-once by decision.
 */
describe('delivery queue', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let outbox: OutboxRepository;
  let delivery: DeliveryService;
  let worker: OutboxWorker;
  let channel: ScriptedChannel;
  let timeZone: string;

  beforeAll(async () => {
    channel = new ScriptedChannel();

    moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, appConfig, outboxConfig, workersConfig)],
      providers: [
        { provide: quietHoursConfig.KEY, useValue: quietHours },
        PrismaService,
        DeliveryService,
        OutboxRepository,
        OutboxWorker,
        QuietHours,
        ChannelRegistry,
        { provide: NOTIFICATION_CHANNELS, useValue: [channel] },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    outbox = moduleRef.get(OutboxRepository);
    delivery = moduleRef.get(DeliveryService);
    worker = moduleRef.get(OutboxWorker);
    timeZone = moduleRef.get<AppConfig>(appConfig.KEY).timeZone;
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    channel.receipt = { ok: true };
    channel.sent.length = 0;
    channel.capabilities = {
      interactiveActions: true,
    };
    quietHours.enabled = false;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** A run nobody asked for: a change in Notion. */
  const NOTICED: Actor = {
    kind: 'run',
    runId: 'run-1',
    mode: 'event_evaluation',
    provenance: { origin: 'evaluation_window' },
    startedAt: new Date(),
  };

  /** A snooze the person set themselves, for example for 01:30. */
  const SNOOZED: Actor = {
    kind: 'run',
    runId: 'run-2',
    mode: 'scheduled_recheck',
    provenance: { origin: 'scheduled_check', reasonCode: 'user_snooze' },
    startedAt: new Date(),
  };

  /** Creates an open proposal: a packet shows only one that exists. */
  const openProposal = (id: string): Promise<unknown> =>
    prisma.pendingAction.create({
      data: {
        id,
        notionPageId: `page-${id}`,
        fingerprint: `fp-${id}`,
        effects: [],
        preconditions: [],
      },
    });

  const queue = (idempotencyKey = 'nudge-1', actor = NOTICED): Promise<NotificationOutbox> =>
    delivery.enqueue(actor, { idempotencyKey, channel: 'telegram', message: PACKET }, NO_OTHERS);

  it('the delivery goes out and the row is concluded', async () => {
    await queue();

    await expect(worker.runOnce()).resolves.toBe(1);

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    expect(row.status).toBe('sent');
    expect(row.sentAt).not.toBeNull();
    expect(channel.sent).toHaveLength(1);
  });

  /**
   * The message id the channel reported is recorded on the row together with `sent`: by it the
   * person replies to the message, and the system edits the message when a proposal closes. The
   * proposal buttons find the row by the content of the packet.
   */
  describe('message id in the channel', () => {
    const PROPOSED = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const buttons: DeliveryRequest['message'] = {
      ...PACKET,
      proposals: [{ pendingActionId: PROPOSED, line: 'Перевести задачу в Next Action' }],
    };

    beforeEach(async () => {
      await openProposal(PROPOSED);
    });

    it('is recorded on the row together with `sent`, and the row is found by it', async () => {
      channel.receipt = { ok: true, externalId: '31' };

      await delivery.enqueue(
        NOTICED,
        {
          idempotencyKey: 'nudge-1',
          channel: 'telegram',
          discussionId: '5b6a4978-8a9b-4c1d-9e2f-3a4b5c6d7e8f',
          message: buttons,
        },
        NO_OTHERS,
      );
      await worker.runOnce();

      await expect(prisma.notificationOutbox.findFirstOrThrow()).resolves.toMatchObject({
        status: 'sent',
        externalId: '31',
      });
      await expect(delivery.threadOf('telegram', '31')).resolves.toBe(
        '5b6a4978-8a9b-4c1d-9e2f-3a4b5c6d7e8f',
      );
      await expect(delivery.threadOf('telegram', '32')).resolves.toBeNull();
    });

    it('a channel that names no id leaves the row without one, and that does not make the delivery a failure', async () => {
      await queue();
      await worker.runOnce();

      await expect(prisma.notificationOutbox.findFirstOrThrow()).resolves.toMatchObject({
        status: 'sent',
        externalId: null,
      });
    });

    it('a message that contains a proposal is found by it', async () => {
      channel.receipt = { ok: true, externalId: '31' };

      await delivery.enqueue(
        NOTICED,
        {
          idempotencyKey: 'nudge-1',
          channel: 'telegram',
          message: buttons,
        },
        NO_OTHERS,
      );
      await queue('nudge-2');
      await worker.runOnce();

      const found = await outbox.sentFor(PROPOSED);

      expect(found.map((row) => row.idempotencyKey)).toEqual(['nudge-1']);
      await expect(outbox.sentFor('9b2d5c1e-3f4a-4b6c-8d7e-1a2b3c4d5e6f')).resolves.toEqual([]);
    });

    it('there is nothing to edit for what has not been sent yet', async () => {
      await delivery.enqueue(
        NOTICED,
        {
          idempotencyKey: 'nudge-1',
          channel: 'telegram',
          message: buttons,
        },
        NO_OTHERS,
      );

      await expect(outbox.sentFor(PROPOSED)).resolves.toEqual([]);
    });
  });

  it('the same logical delivery is queued once', async () => {
    const first = await queue();
    const second = await queue();

    expect(second.id).toBe(first.id);
    await expect(prisma.notificationOutbox.count()).resolves.toBe(1);
  });

  /**
   * Criterion 4 of the gate is enforced by the unique index on `idempotency_key`, not by the
   * order of calls: `createMany({ skipDuplicates })` leaves it to the database to decide which
   * of the concurrent enqueues becomes the row. The sequential twin above checks the same
   * assertion; here it is checked on a path where several enqueues are in flight at once.
   */
  it('concurrent enqueues of the same key fold into one row', async () => {
    await Promise.all([queue(), queue(), queue()]);

    await expect(prisma.notificationOutbox.count()).resolves.toBe(1);
  });

  it('a sent row is not claimed a second time', async () => {
    await queue();
    await worker.runOnce();

    await expect(worker.runOnce()).resolves.toBe(0);
    expect(channel.sent).toHaveLength(1);
  });

  /**
   * A row claimed by a process that fell over before delivery comes back by itself: that is what
   * “a restart does not lose the delivery” means.
   */
  it('a crash between the claim and the delivery does not lose the delivery', async () => {
    await queue();

    const claimed = await outbox.claimDue();

    expect(claimed).toHaveLength(1);
    await expect(outbox.claimDue()).resolves.toHaveLength(0);

    await prisma.notificationOutbox.updateMany({
      data: { lockedUntil: subSeconds(new Date(), 1) },
    });

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(channel.sent).toHaveLength(1);

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    expect(row.status).toBe('sent');
    // One, not two: the provider did not see the first claim, and the row is not charged an
    // attempt for it. The attempt limit is kept for the attempts that really took place.
    expect(row.attemptCount).toBe(1);
  });

  /**
   * The same expired lease, from the queue's side. The cost of a mistake is highest here: a
   * zombie marks as “sent” a row that in fact nobody has sent yet, and the message vanishes
   * silently.
   */
  it('a late “sent” does not conclude a row that another leaseholder holds', async () => {
    await queue();

    const [first] = await outbox.claimDue();

    await prisma.notificationOutbox.updateMany({
      data: { lockedUntil: subSeconds(new Date(), 1) },
    });

    const [second] = await outbox.claimDue();

    expect(second.id).toBe(first.id);
    await expect(outbox.markSent(first)).resolves.toBe(false);

    const after = await prisma.notificationOutbox.findFirstOrThrow();

    expect(after.status).toBe('pending');
    expect(after.lockedUntil?.getTime()).toBe(second.lockedUntil?.getTime());
  });

  /**
   * Every disposition is fenced, not only “sent”. A late retry would shift an attempt that
   * another worker is making at that time, a late retirement would bury a delivery in the
   * middle of its sending, and a late attempt recording would count an attempt someone else made.
   */
  describe('other dispositions of a zombie', () => {
    type Zombie = (
      row: NotificationOutbox & Leased,
    ) => Promise<boolean | NotificationOutbox | null>;

    const zombies: [string, Zombie, false | null][] = [
      ['retry', (row) => outbox.retryLater(row, 'stale'), false],
      ['postponement', (row) => outbox.postpone(row, addHours(new Date(), 1), 'stale'), false],
      ['retirement', (row) => outbox.giveUp(row, 'stale'), false],
      ['attempt recording', (row) => outbox.recordAttempt(row), null],
    ];

    it.each(zombies)(
      'a late “%s” does not touch a row that another leaseholder holds',
      async (_, act, refused) => {
        await queue();

        const [first] = await outbox.claimDue();

        await prisma.notificationOutbox.updateMany({
          data: { lockedUntil: subSeconds(new Date(), 1) },
        });

        const [second] = await outbox.claimDue();

        await expect(act(first)).resolves.toBe(refused);

        const after = await prisma.notificationOutbox.findFirstOrThrow();
        const untouched: Pick<
          NotificationOutbox,
          'status' | 'lastError' | 'nextAttemptAt' | 'attemptCount'
        > = { status: 'pending', lastError: null, nextAttemptAt: null, attemptCount: 0 };

        expect(after).toMatchObject(untouched);
        expect(after.lockedUntil?.getTime()).toBe(second.lockedUntil.getTime());
      },
    );
  });

  /**
   * `INV-021`: a channel without buttons degrades correctly.
   *
   * The sender decides the degradation: it reads the capability flag, the channel only declares
   * what it is, and the packet stays the carrier of the decision — `ask` and the link do not
   * disappear.
   */
  describe('a channel without interactive actions', () => {
    const withAction: DeliveryRequest['message'] = {
      ...PACKET,
      proposals: [{ pendingActionId: PROPOSAL_ID, line: 'Перевести задачу в Next Action' }],
    };

    beforeEach(async () => {
      await openProposal(PROPOSAL_ID);
    });

    it('buttons do not reach the channel', async () => {
      channel.capabilities = { ...channel.capabilities, interactiveActions: false };

      await delivery.enqueue(
        NOTICED,
        {
          idempotencyKey: 'nudge-9',
          channel: 'telegram',
          message: withAction,
        },
        NO_OTHERS,
      );
      await worker.runOnce();

      const [delivered] = channel.sent;

      expect(delivered.actions).toBeUndefined();
      expect(delivered.proposals).toHaveLength(1);
      expect(delivered.ask).toBe(PACKET.ask);
      expect(delivered.link).toBe(PACKET.link);
    });

    it('a channel with buttons receives them', async () => {
      await delivery.enqueue(
        NOTICED,
        {
          idempotencyKey: 'nudge-10',
          channel: 'telegram',
          message: withAction,
        },
        NO_OTHERS,
      );
      await worker.runOnce();

      const [delivered] = channel.sent;

      expect(delivered.actions).toEqual([
        { kind: 'approve', pendingActionId: PROPOSAL_ID },
        { kind: 'reject', pendingActionId: PROPOSAL_ID },
      ]);
    });
  });

  it('a provider error requeues the row with a pause', async () => {
    channel.receipt = { ok: false, error: 'bad gateway' };

    await queue();
    await worker.runOnce();

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    expect(row.status).toBe('pending');
    expect(row.lastError).toBe('bad gateway');
    expect(row.nextAttemptAt?.getTime()).toBeGreaterThan(addSeconds(new Date(), 20).getTime());
    await expect(worker.runOnce()).resolves.toBe(0);
  });

  /**
   * `429` with `retry_after` states the **earliest** time at which retrying is possible; it is not
   * a delivery failure, and it does not say when retrying is worthwhile. This catches the
   * replacement of the queue's own backoff: a burst of flood-waits of 30 s each would squeeze all
   * eight attempts into four minutes, and the message would vanish just when the provider was
   * only asking to wait.
   */
  it("a `retry_after` shorter than the queue's own pause does not shorten it", async () => {
    channel.receipt = { ok: false, error: 'Too Many Requests', retryAfterSeconds: 7 };

    await queue();
    await worker.runOnce();

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    // The queue's own first pause is 30 s, and it is longer than the one the provider indicated.
    expect(pauseOf(row)).toBeGreaterThan(25);
  });

  it("a `retry_after` longer than the queue's own pause extends it", async () => {
    channel.receipt = { ok: false, error: 'Too Many Requests', retryAfterSeconds: 900 };

    await queue();
    await worker.runOnce();

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    expect(pauseOf(row)).toBeGreaterThan(800);
  });

  /**
   * Eight attempts under a continuous flood-wait must spread over the whole profile, not over its
   * first step.
   */
  it('a burst of flood-waits does not burn the limit in minutes', async () => {
    channel.receipt = { ok: false, error: 'Too Many Requests', retryAfterSeconds: 30 };

    await queue();

    const pauses: number[] = [];

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: null } });
      await worker.runOnce();

      const row = await prisma.notificationOutbox.findFirstOrThrow();

      pauses.push(pauseOf(row));
    }

    // 30, 60, 120, 240 — the profile doubles instead of freezing at the hint.
    expect(pauses[3]).toBeGreaterThan(200);
  });

  /**
   * A channel exception is no better than a refusal: the row must return to the queue, otherwise
   * the delivery is lost at the very first network failure.
   */
  it('a channel exception does not lose the delivery but requeues it', async () => {
    channel.receipt = new Error('socket hang up');

    await queue();

    await expect(worker.runOnce()).resolves.toBe(1);

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    expect(row.status).toBe('pending');
    expect(row.attemptCount).toBe(1);
    expect(row.lastError).toBe('socket hang up');
    expect(row.lockedUntil).toBeNull();
    expect(row.nextAttemptAt?.getTime()).toBeGreaterThan(new Date().getTime());
  });

  /**
   * A sent message does not keep the reason of an earlier failure: `last_error` says what is
   * wrong with the row currently, not what once was.
   */
  it('after an exception the next attempt delivers and clears the reason of the failure', async () => {
    channel.receipt = new Error('socket hang up');

    await queue();
    await worker.runOnce();

    channel.receipt = { ok: true };
    await prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: null } });

    await expect(worker.runOnce()).resolves.toBe(1);

    const delivered: Pick<NotificationOutbox, 'status' | 'lastError'> = {
      status: 'sent',
      lastError: null,
    };

    await expect(prisma.notificationOutbox.findFirstOrThrow()).resolves.toMatchObject(delivered);
  });

  it('an exhausted attempt limit moves the row to `failed`', async () => {
    channel.receipt = { ok: false, error: 'bad gateway' };

    await queue();

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: null } });
      await expect(worker.runOnce()).resolves.toBe(1);
    }

    await prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: null } });
    await expect(worker.runOnce()).resolves.toBe(0);

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    expect(row.status).toBe('failed');
    expect(row.attemptCount).toBe(8);
  });

  /**
   * The row is written directly: the delivery service will not let a name that is not among the
   * adapters into the queue. A row for a channel that does not exist is left behind by an
   * installation from which a channel was removed, or by a version that knew another adapter —
   * and the worker must retire it with a reason instead of retrying it.
   */
  it('a row for a channel that does not exist moves to `failed` with a reason', async () => {
    await prisma.notificationOutbox.create({
      data: { idempotencyKey: 'nudge-2', channel: 'slack', payload: storedJson(PACKET) },
    });
    await worker.runOnce();

    const row = await prisma.notificationOutbox.findFirstOrThrow();

    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('channel slack is not configured');
  });

  it('a row with an unrecognized message shape is not retried forever', async () => {
    const row = await queue();

    await prisma.notificationOutbox.update({
      where: { id: row.id },
      data: { payload: { shape: 'from another version' } },
    });

    await worker.runOnce();

    const after = await prisma.notificationOutbox.findFirstOrThrow();

    expect(after.status).toBe('failed');
    expect(after.lastError).toContain('unrecognised payload');
    expect(channel.sent).toHaveLength(0);
  });

  describe('quiet hours', () => {
    /**
     * The window is derived from the clock, not set with numbers.
     *
     * A fixed window has an edge, and one day a run lands exactly on it: `[00:00, 23:59)` would
     * fail at exactly 23:59, because `inside` compares `minute < end`. One minute a day is not
     * rare, it is a schedule.
     *
     * A margin of two minutes on each side survives the minute rolling over in the middle of the
     * test; a narrow “exactly this minute” window would replace a failure that happens on a
     * schedule with one that happens by a race, which is worse because it cannot be reproduced.
     */
    beforeEach(() => {
      const wall = wallClock(timeZone, new Date());
      const minute = wall.hour * 60 + wall.minute;

      Object.assign(quietHours, {
        enabled: true,
        startMinute: (minute - 2 + 1440) % 1440,
        endMinute: (minute + 3) % 1440,
      });
    });

    afterEach(() => {
      Object.assign(quietHours, { enabled: false, startMinute: 0, endMinute: 0 });
    });

    it('the message is postponed, not lost, and spends no attempt', async () => {
      await queue();
      await worker.runOnce();

      const row = await prisma.notificationOutbox.findFirstOrThrow();

      expect(row.status).toBe('pending');
      expect(row.lastError).toBe('quiet hours');
      expect(row.attemptCount).toBe(0);
      expect(channel.sent).toHaveLength(0);
    });

    it('what the person asked for breaks through quiet hours', async () => {
      await queue('nudge-exempt', SNOOZED);
      await worker.runOnce();

      const row = await prisma.notificationOutbox.findFirstOrThrow();

      expect(row.status).toBe('sent');
      expect(channel.sent).toHaveLength(1);
    });
  });
});
