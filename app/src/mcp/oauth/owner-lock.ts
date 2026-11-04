/**
 * How many consecutive failed attempts at the owner passphrase are allowed before the lock
 * closes. There is one passphrase, so there is one counter per process: guessing it from several
 * addresses is as futile as from one.
 */
export const FREE_FAILURES = 5;

/** The first lockout lasts this long; each later one doubles it. */
const FIRST_LOCK_MS = 30_000;

/** The longest lockout: an owner who forgot the passphrase will not wait longer. */
const LONGEST_LOCK_MS = 15 * 60_000;

/**
 * The lockout after failures. After five wrong passphrases in a row the lock is closed for half a
 * minute, then each new failure doubles the duration, up to a quarter of an hour. A correct
 * passphrase resets the counter. While the lock is closed, a correct one is not accepted either,
 * because otherwise the response, or the time it takes, would tell a correct passphrase from a
 * wrong one.
 */
export class OwnerLock {
  private failures = 0;
  private closedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns how many more milliseconds the lock stays closed; `0` means open. */
  closedFor(): number {
    return Math.max(0, this.closedUntil - this.now());
  }

  failed(): void {
    this.failures += 1;

    if (this.failures < FREE_FAILURES) return;

    const doubled = FIRST_LOCK_MS * 2 ** (this.failures - FREE_FAILURES);

    this.closedUntil = this.now() + Math.min(doubled, LONGEST_LOCK_MS);
  }

  succeeded(): void {
    this.failures = 0;
    this.closedUntil = 0;
  }
}
