import { MAX_PACKET_PROPOSALS } from '../../src/delivery/port/channel.port';
import { REVIEW_SCHEDULE_DEFAULTS } from '../../src/reviews/reviews.config';
import { canonical } from './contracts';

/**
 * The numbers of the reviews and the packet in the code are the same as in the contract. The
 * running App does not read contracts, so the code keeps its own copy of them. A number that
 * diverged from the contract would silently change when a review takes place or how many
 * proposals a packet holds.
 */
describe('reviews, the packet and the contract', () => {
  it('the default schedules match', () => {
    expect(REVIEW_SCHEDULE_DEFAULTS).toEqual(canonical.reviewSchedules());
  });

  it('the packet proposal limit matches', () => {
    expect(MAX_PACKET_PROPOSALS).toBe(canonical.notificationPacket().max_proposals);
  });
});
