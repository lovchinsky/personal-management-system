import { Records } from '../../test/fixtures/methodology-records';
import { checkDateReached, deadlineSignal, type PlaceDate } from './time-signals';

/**
 * The fixture's `PlaceDate`: a `YYYY-MM-DD` day is UTC midnight (`end` is the next one), anything
 * else is parsed as the string of an instant. The rule does not know how a date becomes an
 * instant, so a simple placement is enough in the test.
 */
const place: PlaceDate = (date, edge) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date.start);
  if (!day) return Date.parse(date.start);

  return Date.parse(`${date.start}T00:00:00Z`) + (edge === 'end' ? 86_400_000 : 0);
};

const NOW = Date.parse('2026-10-15T12:00:00Z');
const DAY = 86_400_000;

describe('dependency check date', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  it('when the date of a Waiting For has come due, it is time to check', () => {
    const task = records.task({ status: 'Waiting For', date: '2026-10-15' });

    expect(checkDateReached(task, place, NOW)).toEqual({
      state: 'due',
      at: Date.parse('2026-10-15T00:00:00Z'),
    });
  });

  it('while the date has not come due yet, it is not time', () => {
    const task = records.task({ status: 'Waiting For', date: '2026-10-16' });

    expect(checkDateReached(task, place, NOW)).toEqual({ state: 'not_due' });
  });

  it('with no check date it is not time: the person named no time', () => {
    expect(checkDateReached(records.task({ status: 'Waiting For' }), place, NOW)).toEqual({
      state: 'not_due',
    });
  });

  it.each(['Next Action', 'Scheduled', 'Someday/Maybe', 'Done', 'Failed', 'Hidden'])(
    '%s: the date means something else and there is nothing to check',
    (status) => {
      const task = records.task({ status, date: '2026-10-01' });

      expect(checkDateReached(task, place, NOW)).toEqual({ state: 'not_applicable' });
    },
  );

  it('a date that cannot be placed asserts nothing', () => {
    const task = records.task({ status: 'Waiting For', date: '2026-10-01' });

    expect(checkDateReached(task, () => null, NOW)).toEqual({
      state: 'undetermined',
      because: 'gap',
    });
  });
});

describe('deadline risk signal', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  it.each(['Next Action', 'Scheduled', 'Waiting For'])(
    '%s with a past deadline: the deadline has passed',
    (status) => {
      const task = records.task({ status, deadline: '2026-10-14' });

      expect(deadlineSignal(task, place, NOW, 2 * DAY)).toEqual({
        state: 'passed',
        at: Date.parse('2026-10-15T00:00:00Z'),
      });
    },
  );

  it('a deadline today has not passed yet: the deadline day lasts to its end', () => {
    const task = records.task({ status: 'Next Action', deadline: '2026-10-15' });

    expect(deadlineSignal(task, place, NOW, 2 * DAY)).toEqual({ state: 'none' });
  });

  it('a Waiting For with a deadline within the threshold: the work is stalled on a dependency', () => {
    const task = records.task({ status: 'Waiting For', deadline: '2026-10-16' });

    expect(deadlineSignal(task, place, NOW, 2 * DAY)).toEqual({
      state: 'near',
      at: Date.parse('2026-10-17T00:00:00Z'),
    });
  });

  it('a near deadline on work that can be done is not a signal', () => {
    const task = records.task({ status: 'Next Action', deadline: '2026-10-16' });

    expect(deadlineSignal(task, place, NOW, 2 * DAY)).toEqual({ state: 'none' });
  });

  it('a far-off deadline signals nothing', () => {
    const task = records.task({ status: 'Waiting For', deadline: '2026-11-20' });

    expect(deadlineSignal(task, place, NOW, 2 * DAY)).toEqual({ state: 'none' });
  });

  it.each(['Someday/Maybe', 'Done', 'Canceled', 'Failed', 'Hidden'])(
    '%s is not a commitment with a time',
    (status) => {
      const task = records.task({ status, deadline: '2026-10-01' });

      expect(deadlineSignal(task, place, NOW, 2 * DAY)).toEqual({ state: 'not_applicable' });
    },
  );
});
