import { scheduledCheckEnvelope } from '../continuations/scheduled-check.rows';
import type { WakeFailure } from '../continuations/wake-failure-notice';
import { ScheduledCheck } from '../generated/prisma/client';
import type { Gender } from '../texts/gender';
import type { Language } from '../texts/language';
import { textsOf } from '../texts/texts';
import { Delivery, deliverySchema } from './delivery.schema';
import { outboundMessageSchema } from './port/channel.port';
import { wakeFailureDelivery } from './wake-failure.message';

const KYIV = 'Europe/Kyiv';
const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

/** A snooze for Monday, 09:00 Kyiv time (daylight saving time, UTC+3). */
const SNOOZE: WakeFailure = {
  cause: 'check-1:2',
  reasonCode: 'user_snooze',
  pageId: PAGE,
  discussionId: THREAD,
  runAt: new Date('2026-07-06T06:00:00.000Z'),
};

/** The time of sending: in the same year as the wake, so the year is not shown. */
const NOW = new Date('2026-07-06T10:00:00.000Z');

/** The installation's notice: the wording here is the specification of the language's catalog. */
const failureOf = (
  failure: WakeFailure,
  gender: Gender = 'masculine',
  language: Language = 'uk',
): Delivery =>
  wakeFailureDelivery(
    failure,
    textsOf(language).notices.wakeFailure,
    { language, timeZone: KYIV, gender },
    NOW,
  );

/**
 * The notice about a wake that did not take place is a complete packet that passes the port
 * schema.
 */
describe('the notice about a wake that did not take place', () => {
  it('says which reminder did not fire, why it matters and what to do, with the thread and the page', () => {
    const delivery: Delivery = {
      idempotencyKey: 'event:check-1:2',
      channel: 'telegram',
      discussionId: THREAD,
      message: {
        noticed: 'Нагадування на 6 липня о 9:00, про яке ти просив, не спрацювало.',
        whyItMatters: 'У названий час справа до тебе не повернулася й лишилася без уваги.',
        ask: 'Глянь на справу в Notion, коли зможеш: сама система до неї вже не повернеться.',
        link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
      },
    };

    expect(failureOf(SNOOZE)).toEqual(delivery);
  });

  /**
   * The grammatical gender in which the owner is addressed is an installation setting; without it,
   * sentences have no gender forms.
   */
  it.each([
    ['masculine', 'Нагадування на 6 липня о 9:00, про яке ти просив, не спрацювало.'],
    ['feminine', 'Нагадування на 6 липня о 9:00, про яке ти просила, не спрацювало.'],
    ['neutral', 'Твоє нагадування на 6 липня о 9:00 не спрацювало.'],
  ] as const)('words the reminder in the %s gender', (gender, noticed) => {
    expect(failureOf(SNOOZE, gender).message.noticed).toBe(noticed);
  });

  it.each([
    ['masculine', 'Дедлайн ставив ти, а перевірки, чи справа встигає, не було.'],
    ['feminine', 'Дедлайн ставила ти, а перевірки, чи справа встигає, не було.'],
    ['neutral', 'Це твій дедлайн, а перевірки, чи справа до нього встигає, не було.'],
  ] as const)('a deadline check has its own wording, in the %s gender', (gender, whyItMatters) => {
    const { message } = failureOf({ ...SNOOZE, reasonCode: 'deadline_followup' }, gender);

    expect(message.noticed).toBe('Перевірка дедлайну, призначена на 6 липня о 9:00, не відбулася.');
    expect(message.whyItMatters).toBe(whyItMatters);
  });

  /**
   * The key is the same one the run of this wake would have set: a reminder the run managed to
   * queue before it failed yields no second message.
   */
  it('the key is the delivery key of the run of this wake', () => {
    const check: ScheduledCheck = {
      id: 'check-1',
      discussionId: THREAD,
      notionPageId: PAGE,
      runAt: SNOOZE.runAt,
      reasonCode: 'user_snooze',
      version: 2,
      status: 'failed',
      attemptCount: 3,
      lockedUntil: null,
      lastAttemptAt: null,
      lastError: 'attempt limit reached',
      failureNoticedAt: null,
      notionHoldUntil: null,
      notionHeldSince: null,
      createdAt: SNOOZE.runAt,
      updatedAt: SNOOZE.runAt,
    };

    expect(failureOf(SNOOZE).idempotencyKey).toBe(
      `event:${scheduledCheckEnvelope(check).trigger.event_id}`,
    );
  });

  it('a wake of a page without a thread yields a notice without a thread', () => {
    expect(failureOf({ ...SNOOZE, discussionId: null }).discussionId).toBeUndefined();
  });

  /**
   * The time in words, on the wall clock of the installation's zone; a clock change does not
   * shift it.
   */
  it.each([
    ['2026-01-12T07:00:00.000Z', '12 січня о 9:00'],
    ['2026-07-06T06:00:00.000Z', '6 липня о 9:00'],
    ['2026-10-24T21:00:00.000Z', '25 жовтня о 0:00'],
    ['2026-10-25T00:30:00.000Z', '25 жовтня о 3:30'],
    ['2026-10-25T01:30:00.000Z', '25 жовтня о 3:30'],
    ['2026-03-29T01:00:00.000Z', '29 березня о 4:00'],
  ])('%s is “%s” in Kyiv time', (at, moment) => {
    expect(failureOf({ ...SNOOZE, runAt: new Date(at) }).message.noticed).toContain(moment);
  });

  it('the year is shown only when it is not the current one', () => {
    const later = failureOf({ ...SNOOZE, runAt: new Date('2027-01-12T07:00:00.000Z') });

    expect(later.message.noticed).toContain('12 січня 2027 р. о 9:00');
  });

  it('the packet passes the delivery and port schemas, with no reason and no proposals', () => {
    const delivery = failureOf(SNOOZE);

    expect(deliverySchema.safeParse(delivery).success).toBe(true);
    expect(outboundMessageSchema.safeParse(delivery.message).success).toBe(true);
    expect(delivery.message.context).toBeUndefined();
    expect(delivery.message.proposals).toBeUndefined();
  });

  /**
   * The same builder, another catalog: grammar is the language's job, not the code's; English has
   * no gender.
   */
  it('has the same parts in English, with its own grammar', () => {
    expect(failureOf(SNOOZE, 'feminine', 'en').message).toEqual({
      noticed: 'The reminder you asked for on July 6 at 9:00 AM did not go off.',
      whyItMatters:
        'At the time you named, the matter did not come back to you and has had no attention.',
      ask: 'Have a look at the matter in Notion when you can: the system will not come back to it on its own.',
      link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
    });
  });
});
