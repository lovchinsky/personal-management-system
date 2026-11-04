import { registerAs, type ConfigType } from '@nestjs/config';

/** Pruning: how often it runs and how long the data it prunes lives. */
export const maintenanceConfig = registerAs('maintenance', () => ({
  /** The pause between prunings. Once a day, because pruning is tidying up, not work. */
  intervalHours: 24,
  /** The pause before the first pruning after startup. */
  firstDelayMinutes: 10,
  /**
   * How many days receipts and concluded queue rows live. The retention period is derived from
   * the provider's redelivery window, not chosen (`docs/2-system.md` § “`webhook_receipts`”).
   */
  receiptRetentionDays: 7,
  /**
   * How many days a thread stays in the system's registry after the system's last write to it.
   * `contracts/canonical.yaml`, key `system_discussion`, says what the limit is for.
   *
   * Half a year is longer than the quarterly cycle of the Strategic Review, so a thread the
   * system wrote to during the last cycle is still a conversation when the person's reply
   * arrives. The limit does not apply to a thread with an open continuation or proposal, because
   * the system manages it by those signals, not by the registry.
   */
  systemDiscussionRetentionDays: 180,
}));

export type MaintenanceConfig = ConfigType<typeof maintenanceConfig>;
