import { Test } from '@nestjs/testing';
import { wallClock } from '../../src/platform/time/local-day';
import { emptyResidue, type Residue } from './gate-cleanup';
import { dayIn, ScenarioWorld } from './scenario-world';

describe('the date a few days ahead', () => {
  const cases: [string, { year: number; month: number; day: number }, number, string][] = [
    ['within a month', { year: 2026, month: 10, day: 24 }, 3, '2026-10-27'],
    ['across a month boundary', { year: 2026, month: 10, day: 30 }, 3, '2026-11-02'],
    ['across a year boundary', { year: 2026, month: 12, day: 30 }, 3, '2027-01-02'],
    ['back across a month boundary', { year: 2026, month: 3, day: 1 }, -1, '2026-02-28'],
    ['back in a leap year', { year: 2028, month: 3, day: 1 }, -1, '2028-02-29'],
    ['zero days is today', { year: 2026, month: 10, day: 24 }, 0, '2026-10-24'],
  ];

  it.each(cases)('%s', (_, today, days, expected) => {
    expect(dayIn(today, days)).toBe(expected);
  });

  /**
   * Kyiv switches to winter time on 25.10.2026, so the day of 25.10 lasts 25 hours. Measuring
   * from an instant (“in 72 hours”) would yield, at night on 24.10, a date a day earlier than
   * “today + 3 days”.
   */
  it('the switch to winter time does not shift the date', () => {
    const nightBefore = new Date('2026-10-23T21:30:00.000Z');

    expect(wallClock('Europe/Kyiv', nightBefore)).toMatchObject({ month: 10, day: 24, hour: 0 });
    expect(dayIn(wallClock('Europe/Kyiv', nightBefore), 3)).toBe('2026-10-27');
  });
});

describe('ScenarioWorld: stop by a signal', () => {
  /**
   * After a stop the world creates no page: the very first attempt to create one throws before
   * reaching Notion.
   */
  it('the world is not built after a stop', async () => {
    const app = await Test.createTestingModule({}).compile();

    class Probe extends ScenarioWorld {
      override clean(): Promise<readonly string[]> {
        return Promise.resolve([]);
      }
    }

    const world = new Probe(app, 'm6');
    const residue: Residue = emptyResidue();

    await world.abandon();

    await expect(
      world.build([{ key: 'task', type: 'task', name: 'Задача', status: 'Next Action' }], residue),
    ).rejects.toThrow('stopped by a signal');
    expect(residue.pages).toEqual([]);
  });
});
