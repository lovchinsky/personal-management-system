import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfig } from '../../config/app.config';
import { instantOfLocalTime, startOfNextLocalDay, wallClock } from '../../platform/time/local-day';
import { quietHoursConfig, type QuietHoursConfig } from './quiet-hours.config';

/**
 * The window in which the phone stays silent: it postpones delivery, not the run
 * (`docs/3-policy.md` § “Quiet hours”).
 *
 * Which rows the window does not apply to is not decided here, because a row has its exemption from
 * the time it is enqueued (`quietHoursExempt`). The worker asks the window only about the rest.
 */
@Injectable()
export class QuietHours {
  constructor(
    @Inject(quietHoursConfig.KEY) private readonly quiet: QuietHoursConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * Returns when delivery is allowed, or `null` if it is allowed immediately.
   *
   * Returning a time rather than a flag is deliberate. The queue already has a “not before” field,
   * and quiet hours use it, so the message is postponed, not lost.
   */
  silentUntil(at: Date = new Date()): Date | null {
    const window = this.quiet;
    if (!window.enabled) {
      return null;
    }
    if (window.startMinute === window.endMinute) {
      return null;
    }

    const timeZone = this.app.timeZone;
    const wall = wallClock(timeZone, at);
    const minute = wall.hour * 60 + wall.minute;

    const crossesMidnight = window.startMinute > window.endMinute;

    const inside = crossesMidnight
      ? minute >= window.startMinute || minute < window.endMinute
      : minute >= window.startMinute && minute < window.endMinute;

    if (!inside) {
      return null;
    }

    // A window that crosses midnight ends the next day, but only if we are in its evening half.
    // At two in the morning it ends today.
    const endsTomorrow = crossesMidnight && minute >= window.startMinute;
    const day = endsTomorrow ? startOfNextLocalDay(timeZone, at) : at;

    return instantOfLocalTime(timeZone, day, window.endMinute);
  }
}
