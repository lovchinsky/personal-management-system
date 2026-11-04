import { wallClock } from '../../src/platform/time/local-day';

const TIME_ZONE = 'Europe/Kyiv';

/**
 * The daily limit opens at the start of the next local day: the run gates report this time as
 * the one until which they are closed to autonomous runs.
 *
 * Two properties of the time are checked, not its value: it is in the future and it is local
 * midnight. That keeps the assertion true at any hour: “more than an hour ahead” would fail
 * every evening after 23:00.
 *
 * This does not turn into a tautology: `wallClock` reads the time in the zone independently of
 * how the production code computed it. An implementation that returns “the current time plus a day”
 * fails the midnight check, and one that returns “today's midnight” fails the future check.
 */
export function expectStartOfNextLocalDay(moment: Date): void {
  const wall = wallClock(TIME_ZONE, moment);

  expect(moment.getTime()).toBeGreaterThan(new Date().getTime());
  expect({ hour: wall.hour, minute: wall.minute }).toEqual({ hour: 0, minute: 0 });
}
