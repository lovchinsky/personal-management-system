import { allowanceOf, FREE_ALLOWANCE } from './gate.config';
import { ALLOWANCE_WINDOW_MS, AllowanceLedger } from './notion-allowance';
import type { NotionRead } from './run-reads';

const MINUTE = 60_000;
const T0 = new Date('2026-10-21T08:00:00.000Z').getTime();

/** Makes a metered call at the instant `at` (minutes from T0). */
const metered = (at: number, refused = false): NotionRead => ({
  tool: 'notion-query-data-sources',
  mode: 'sql',
  at: new Date(T0 + at * MINUTE).toISOString(),
  ok: !refused,
  refused,
  metered: true,
  pages: [],
  dataSources: [],
});

const fetched: NotionRead = {
  tool: 'notion-fetch',
  mode: null,
  at: new Date(T0).toISOString(),
  ok: true,
  refused: false,
  metered: false,
  pages: [],
  dataSources: [],
};

describe('AllowanceLedger', () => {
  it('a run does not wait when no allowance applies', () => {
    const ledger = new AllowanceLedger(null);

    ledger.record(
      'weekly_control_review',
      Array.from({ length: 30 }, () => metered(0)),
      T0,
    );

    expect(ledger.readyAt('weekly_control_review', T0)).toBe(T0);
  });

  it('before the first measurement an event run needs two calls and a review the whole allowance', () => {
    const ledger = new AllowanceLedger(10);

    expect(ledger.needOf('event_evaluation')).toBe(2);
    expect(ledger.needOf('weekly_control_review')).toBe(10);
  });

  /**
   * The first review does not know its need, so it waits until every call drops out of the hour.
   */
  it('a review before the first measurement waits until the last call of the hour drops out', () => {
    const ledger = new AllowanceLedger(10);

    ledger.record('event_evaluation', [metered(0), metered(20)], T0);

    expect(ledger.readyAt('daily_control', T0 + 30 * MINUTE)).toBe(T0 + 80 * MINUTE);
    expect(ledger.readyAt('event_evaluation', T0 + 30 * MINUTE)).toBe(T0 + 30 * MINUTE);
  });

  it('the need of a mode is the most a run of that mode spent; reads that are not metered do not count', () => {
    const ledger = new AllowanceLedger(10);

    ledger.record('daily_control', [metered(0), metered(1), metered(2), fetched], T0);
    ledger.record('daily_control', [metered(5)], T0);

    expect(ledger.needOf('daily_control')).toBe(3);
  });

  /**
   * The rule covers any 60 minutes, so it enforces the allowance wherever Notion opens its window.
   */
  it('under the rule “no more than N in any 60 minutes” the wait lasts until the oldest calls age out', () => {
    const ledger = new AllowanceLedger(10);

    ledger.record(
      'daily_control',
      Array.from({ length: 8 }, (_, minute) => metered(minute)),
      T0,
    );

    // 8 in the hour, need 8: fits once the six oldest age out.
    expect(ledger.readyAt('daily_control', T0 + 10 * MINUTE)).toBe(
      T0 + 5 * MINUTE + ALLOWANCE_WINDOW_MS,
    );
  });

  it('a refusal exhausts the hour after it, and a refused call takes no allowance but shows the need', () => {
    const ledger = new AllowanceLedger(10);

    ledger.record('weekly_control_review', [metered(0), metered(1), metered(2, true)], T0);

    expect(ledger.readyAt('event_evaluation', T0 + 3 * MINUTE)).toBe(
      T0 + 2 * MINUTE + ALLOWANCE_WINDOW_MS,
    );
    expect(ledger.needOf('weekly_control_review')).toBe(3);
  });

  it('a need above the allowance is the whole allowance, so the run waits for an empty hour, not forever', () => {
    const ledger = new AllowanceLedger(10);

    ledger.record(
      'weekly_control_review',
      Array.from({ length: 12 }, () => metered(0)),
      T0,
    );

    expect(ledger.needOf('weekly_control_review')).toBe(10);
  });

  it('the ledger restored from transcripts has no mode, so it changes no need', () => {
    const ledger = new AllowanceLedger(10);

    ledger.record(null, [metered(0)], T0);

    expect(ledger.needOf('daily_control')).toBe(10);
  });
});

describe('allowanceOf', () => {
  it('unset is the Free allowance, `unlimited` means no allowance applies, a number is the allowance per hour', () => {
    expect(allowanceOf(undefined)).toBe(FREE_ALLOWANCE);
    expect(allowanceOf('unlimited')).toBeNull();
    expect(allowanceOf('25')).toBe(25);
  });

  it('anything else is a configuration error, not a silent allowance', () => {
    expect(() => allowanceOf('lots')).toThrow('GATE_NOTION_QUERY_ALLOWANCE');
    expect(() => allowanceOf('0')).toThrow('GATE_NOTION_QUERY_ALLOWANCE');
  });
});
