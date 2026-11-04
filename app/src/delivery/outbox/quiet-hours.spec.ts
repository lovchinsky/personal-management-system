import { hoursToMinutes } from 'date-fns';
import { type AppConfig } from '../../config/app.config';
import { QuietHours } from './quiet-hours';
import { type QuietHoursConfig } from './quiet-hours.config';

const KYIV = 'Europe/Kyiv';

const APP: AppConfig = { port: 3000, timeZone: KYIV, language: 'uk', ownerGender: 'neutral' };

/** The window from 23:00 to 08:00, as in an application with no settings. */
const NIGHT: QuietHoursConfig = {
  enabled: true,
  startMinute: hoursToMinutes(23),
  endMinute: hoursToMinutes(8),
};

function hours(config: Partial<QuietHoursConfig> = {}): QuietHours {
  return new QuietHours({ ...NIGHT, ...config }, APP);
}

describe('quiet hours', () => {
  const quiet = hours();

  it.each([
    ['2026-01-15T20:30:00Z', '22:30 — до вікна'],
    ['2026-01-15T06:30:00Z', '08:30 — після вікна'],
    ['2026-01-15T12:00:00Z', 'обід'],
  ])('%s: delivered immediately (%s)', (iso) => {
    expect(quiet.silentUntil(new Date(iso))).toBeNull();
  });

  it('at 23:30 local time delivery is postponed until 08:00 the next day', () => {
    // 23:30 in Kyiv in winter = 21:30 UTC
    const at = new Date('2026-01-15T21:30:00Z');

    expect(quiet.silentUntil(at)?.toISOString()).toBe('2026-01-16T06:00:00.000Z');
  });

  it('at 02:00 local time delivery is postponed until 08:00 the same day', () => {
    const at = new Date('2026-01-16T00:00:00Z');

    expect(quiet.silentUntil(at)?.toISOString()).toBe('2026-01-16T06:00:00.000Z');
  });

  it('at exactly 23:00 the window is already in effect, at exactly 08:00 it is not', () => {
    expect(quiet.silentUntil(new Date('2026-01-15T21:00:00Z'))).not.toBeNull();
    expect(quiet.silentUntil(new Date('2026-01-16T06:00:00Z'))).toBeNull();
  });

  /**
   * On the day of the switch to daylight saving time, the window ends at 08:00 under a different
   * offset from the one the day began with, so “midnight plus eight hours” would yield nine in the
   * morning.
   */
  it('the switch to daylight saving time does not shift the end of the window', () => {
    // 01:00 Kyiv time on March 29, still +2; the window ends at 08:00, already at +3.
    const at = new Date('2026-03-28T23:00:00Z');

    expect(quiet.silentUntil(at)?.toISOString()).toBe('2026-03-29T05:00:00.000Z');
  });

  /**
   * 03:30 on March 29 does not exist in Kyiv: the clock jumps from 03:00 straight to 04:00. A
   * window end that falls in the skipped time comes later by the length of the transition — at
   * 04:30 (01:30 UTC) — instead of being lost or waiting until repeated postponements catch up
   * with the clock.
   */
  it('a window end in the skipped hour comes later by the length of the transition', () => {
    const shortNight = hours({ endMinute: hoursToMinutes(3) + 30 });
    const at = new Date('2026-03-28T21:30:00Z');

    expect(shortNight.silentUntil(at)?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('a window that does not cross midnight works the same way', () => {
    const daytime = hours({ startMinute: hoursToMinutes(13), endMinute: hoursToMinutes(14) });

    // 13:30 in Kyiv in winter = 11:30 UTC
    expect(daytime.silentUntil(new Date('2026-01-15T11:30:00Z'))?.toISOString()).toBe(
      '2026-01-15T12:00:00.000Z',
    );
    expect(daytime.silentUntil(new Date('2026-01-15T13:00:00Z'))).toBeNull();
  });

  it('a disabled window postpones nothing', () => {
    expect(hours({ enabled: false }).silentUntil(new Date('2026-01-15T21:30:00Z'))).toBeNull();
  });

  it('an empty window postpones nothing', () => {
    const empty = hours({ endMinute: hoursToMinutes(23) });

    expect(empty.silentUntil(new Date('2026-01-15T21:30:00Z'))).toBeNull();
  });
});
