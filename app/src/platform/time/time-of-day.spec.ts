import { parseTimeOfDay } from './time-of-day';

describe('parsing a time of day', () => {
  it.each([
    ['00:00', 0],
    ['08:00', 480],
    ['23:59', 1439],
  ])('%s → %s minutes', (value, minutes) => {
    expect(parseTimeOfDay(value)).toBe(minutes);
  });

  it.each(['8:00', '24:00', '23:60', '', 'девʼята'])('%s is rejected', (value) => {
    expect(() => parseTimeOfDay(value)).toThrow(/HH:MM/);
  });
});
