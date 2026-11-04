import { textsOf } from '../texts/texts';
import { Delivery, deliverySchema } from './delivery.schema';
import { outboundMessageSchema } from './port/channel.port';
import { reviewFailureDelivery, type ReviewFailure } from './review-failure.message';

const WEEKLY: ReviewFailure = {
  mode: 'weekly_control_review',
  occurrenceKey: '2026-W43',
  reason: 'the period ended before the review was done',
};

/**
 * The installation's current date: the periods below fall in the current year, so the year is not
 * shown.
 */
const TODAY = { year: 2026, month: 10, day: 27 };

/** The notice in `uk`: the wording here is the specification of the Ukrainian catalog. */
const failureOf = (failure: ReviewFailure): Delivery =>
  reviewFailureDelivery(failure, textsOf('uk').notices.reviewFailure, 'uk', TODAY);

/**
 * The notice about a review that did not take place is a complete packet that passes the port
 * schema.
 */
describe('the notice about a review that did not take place', () => {
  it('says which review did not take place and for which period, what went unreviewed and how to start it', () => {
    expect(failureOf(WEEKLY).message).toEqual({
      noticed: 'Тижневий огляд за 19–25 жовтня не відбувся.',
      whyItMatters: 'Застояні записи Inbox, очікування й ризики лишилися без перегляду.',
      context: 'Причина: the period ended before the review was done',
      ask: 'Якщо він потрібен, напиши мені в чаті Claude: «зроби тижневий огляд».',
      link: 'https://www.notion.so/',
    });
  });

  it("each kind of key yields its period in the person's words", () => {
    const noticed = (failure: ReviewFailure): string => failureOf(failure).message.noticed;

    expect(noticed({ mode: 'daily_control', occurrenceKey: '2026-10-22', reason: null })).toBe(
      'Щоденний огляд за 22 жовтня не відбувся.',
    );
    // A week across the year boundary: the year is shown because the two days are not both in the
    // current year.
    expect(noticed({ ...WEEKLY, occurrenceKey: '2026-W53' })).toBe(
      'Тижневий огляд за 28 грудня 2026 – 3 січня 2027\u202fрр. не відбувся.',
    );
    expect(noticed({ mode: 'strategic_review', occurrenceKey: '2026-10', reason: null })).toBe(
      'Стратегічний огляд за жовтень 2026 р. не відбувся.',
    );
    expect(noticed({ mode: 'deep_review', occurrenceKey: '2026-Q4', reason: null })).toBe(
      'Глибокий огляд за IV квартал 2026 р. не відбувся.',
    );
  });

  /**
   * Every review follows one pattern: what did not take place, what went unreviewed, how to start
   * it.
   */
  it.each([
    ['daily_control', '2026-10-22', 'зроби щоденний огляд'],
    ['weekly_control_review', '2026-W43', 'зроби тижневий огляд'],
    ['strategic_review', '2026-10', 'зроби стратегічний огляд'],
    ['deep_review', '2026-Q4', 'зроби глибокий огляд'],
  ] as const)('%s: the packet fits the delivery schema and the ask limit', (mode, key, request) => {
    const delivery = failureOf({ mode, occurrenceKey: key, reason: null });

    expect(deliverySchema.safeParse(delivery).success).toBe(true);
    expect(outboundMessageSchema.safeParse(delivery.message).success).toBe(true);
    expect(delivery.message.whyItMatters).toMatch(/^\p{Lu}.+ лишилися без перегляду\.$/u);
    expect(delivery.message.ask).toBe(
      `Якщо він потрібен, напиши мені в чаті Claude: «${request}».`,
    );
  });

  it('the key is the review and the period: the same occurrence yields the same key', () => {
    expect(failureOf(WEEKLY).idempotencyKey).toBe('review-failed:weekly_control_review:2026-W43');
    expect(failureOf({ ...WEEKLY, reason: 'other' }).idempotencyKey).toBe(
      failureOf(WEEKLY).idempotencyKey,
    );
  });

  it('a long reason stays within the limit, and with no reason there is no context', () => {
    const long = failureOf({ ...WEEKLY, reason: 'x'.repeat(5_000) });

    expect(deliverySchema.safeParse(long).success).toBe(true);
    expect(long.message.context?.length).toBeLessThan(400);
    expect(failureOf({ ...WEEKLY, reason: null }).message.context).toBeUndefined();
  });

  /** The person starts a review in the chat, not with a button: the message has no decision. */
  it('has no proposals, and so no buttons', () => {
    expect(failureOf(WEEKLY).message.proposals).toBeUndefined();
  });

  /** The same builder, another catalog: grammar is the language's job, not the code's. */
  it('has the same parts in English, with its own grammar', () => {
    expect(
      reviewFailureDelivery(WEEKLY, textsOf('en').notices.reviewFailure, 'en', TODAY).message,
    ).toEqual({
      noticed: 'The weekly review for October 19\u2009–\u200925 did not take place.',
      whyItMatters: 'Stale Inbox items, waiting-for items and risks went unreviewed.',
      context: 'Reason: the period ended before the review was done',
      ask: 'If you need it, ask me in a Claude chat: “do a weekly review”.',
      link: 'https://www.notion.so/',
    });
  });
});
