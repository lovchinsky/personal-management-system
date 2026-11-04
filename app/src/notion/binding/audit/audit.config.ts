import { registerAs, type ConfigType } from '@nestjs/config';

/**
 * The binding check against the live workspace: how often it runs and when it first runs after
 * startup.
 */
export const bindingAuditConfig = registerAs('bindingAudit', () => ({
  /**
   * Once a day, not on every run, because the question is not data freshness but whether the
   * property we filter on has disappeared. A person makes such changes by hand. A day's delay in
   * finding them costs exactly one day of a silently disabled detector, whereas a check on every
   * event would cost a Notion call per event.
   */
  intervalHours: 24,
  /** The pause before the first check after startup. */
  firstDelayMinutes: 5,
}));

export type BindingAuditConfig = ConfigType<typeof bindingAuditConfig>;
