import { BreakerOpening } from '../runs/breaker-notice';
import { textsOf } from '../texts/texts';
import { breakerDelivery } from './breaker.message';
import { Delivery, deliverySchema } from './delivery.schema';

const OPENING: BreakerOpening = {
  lastFailedRunId: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
  reason: 'mcp server notion: needs-auth',
  pageId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
  failures: 5,
};

/** Builds the notice in `uk`. The wording here is the specification of the Ukrainian catalog. */
const breakerOf = (opening: BreakerOpening): Delivery =>
  breakerDelivery(opening, textsOf('uk').notices.breaker);

/** A notice about an open breaker is a complete packet that passes the port schema. */
describe('open breaker notice', () => {
  it('derives its key from the last failed run', () => {
    expect(breakerOf(OPENING).idempotencyKey).toBe(`breaker:${OPENING.lastFailedRunId}`);
    expect(breakerOf({ ...OPENING, lastFailedRunId: 'other' }).idempotencyKey).toBe(
      'breaker:other',
    );
  });

  it('has a packet that passes the delivery schema', () => {
    expect(deliverySchema.safeParse(breakerOf(OPENING)).success).toBe(true);
  });

  it('links to the page the run was about, and has no link without one', () => {
    expect(breakerOf(OPENING).message.link).toBe(
      'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
    );
    expect(breakerOf({ ...OPENING, pageId: null }).message.link).toBeUndefined();
  });

  it('includes the failure reason and stays within the limit', () => {
    expect(breakerOf(OPENING).message.context).toContain('mcp server notion: needs-auth');

    const long = breakerOf({ ...OPENING, reason: 'x'.repeat(5_000) });

    expect(deliverySchema.safeParse(long).success).toBe(true);
    expect(long.message.context?.length).toBeLessThan(400);
  });

  it('has no context without a reason', () => {
    expect(breakerOf({ ...OPENING, reason: null }).message.context).toBeUndefined();
  });

  /** The person repairs the breakage, not a button, so the notice contains no decision. */
  it('has no proposals, and so no buttons', () => {
    expect(breakerOf(OPENING).message.proposals).toBeUndefined();
  });
});
