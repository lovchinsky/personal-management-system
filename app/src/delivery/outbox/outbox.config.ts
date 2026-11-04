import { registerAs, type ConfigType } from '@nestjs/config';

/** The delivery queue and its worker: row lease, pace, batch and retries. */
export const outboxConfig = registerAs('outbox', () => ({
  /**
   * How long a delivery row counts as taken after a claim. The lease must be clearly longer
   * than the longest send and clearly shorter than a tolerable outage: the first bound keeps two
   * workers from taking the same row, the second determines how quickly the row of a crashed
   * process is made claimable again.
   */
  leaseSeconds: 900,
  /** The pause between ticks of the delivery worker. */
  tickSeconds: 15,
  /** How many deliveries one tick claims. */
  batchSize: 5,
  /**
   * How many attempts one delivery gets. Why eight, and what they cover, is explained in
   * `docs/2-system.md` § “Telegram — channel adapter”.
   */
  maxAttempts: 8,
  /** The first pause before a delivery retry. It then doubles up to the ceiling. */
  backoffSeconds: 30,
  backoffCapSeconds: 3_600,
}));

export type OutboxConfig = ConfigType<typeof outboxConfig>;
