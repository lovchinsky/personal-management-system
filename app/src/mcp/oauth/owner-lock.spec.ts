import { OwnerLock } from './owner-lock';

describe('lockout after failed owner attempts', () => {
  /** The test clock: it stands still until it is advanced. */
  function clock(): { now: () => number; advance: (ms: number) => void } {
    let moment = 1_000_000;

    return { now: () => moment, advance: (ms) => (moment += ms) };
  }

  it('the lock is open before the fifth consecutive failure', () => {
    const lock = new OwnerLock(clock().now);

    for (let attempt = 0; attempt < 4; attempt += 1) lock.failed();

    expect(lock.closedFor()).toBe(0);
  });

  it('the fifth failure closes the lock for half a minute and each further one doubles the duration', () => {
    const time = clock();
    const lock = new OwnerLock(time.now);

    for (let attempt = 0; attempt < 5; attempt += 1) lock.failed();

    expect(lock.closedFor()).toBe(30_000);

    time.advance(30_000);
    lock.failed();

    expect(lock.closedFor()).toBe(60_000);
  });

  it('the duration does not exceed a quarter of an hour', () => {
    const lock = new OwnerLock(clock().now);

    for (let attempt = 0; attempt < 40; attempt += 1) lock.failed();

    expect(lock.closedFor()).toBe(15 * 60_000);
  });

  it('the lock opens on its own once the duration has elapsed', () => {
    const time = clock();
    const lock = new OwnerLock(time.now);

    for (let attempt = 0; attempt < 5; attempt += 1) lock.failed();

    time.advance(30_001);

    expect(lock.closedFor()).toBe(0);
  });

  it('a success resets the counter', () => {
    const lock = new OwnerLock(clock().now);

    for (let attempt = 0; attempt < 4; attempt += 1) lock.failed();

    lock.succeeded();
    lock.failed();

    expect(lock.closedFor()).toBe(0);
  });
});
