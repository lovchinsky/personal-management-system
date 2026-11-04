import { Records } from '../../test/fixtures/methodology-records';
import type { Reading } from '../notion/semantics/reading';
import { lifecycleOf, phaseOf } from './lifecycle';

describe('Task lifecycle and Project phase', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  describe('Task status', () => {
    /**
     * There are seven Task statuses: four open, three terminal (`docs/1-methodology.md` § “Task
     * Status”).
     */
    it.each([
      ['Next Action', 'open'],
      ['Scheduled', 'open'],
      ['Waiting For', 'open'],
      ['Someday/Maybe', 'open'],
      ['Done', 'terminal'],
      ['Canceled', 'terminal'],
      ['Failed', 'terminal'],
    ] as const)('%s is %s', (status, state) => {
      expect(lifecycleOf(records.task({ status }).readings.status)).toEqual({ state, status });
    });

    it('Hidden is outside the model: neither open nor closed', () => {
      expect(lifecycleOf(records.task({ status: 'Hidden' }).readings.status)).toEqual({
        state: 'out_of_scope',
        value: 'Hidden',
      });
    });

    it('an unknown option is a model gap, and nothing is asserted', () => {
      expect(lifecycleOf(records.task({ status: 'Blocked' }).readings.status)).toEqual({
        state: 'undetermined',
        because: 'gap',
      });
    });

    /**
     * The adapter returns an unknown option as a `gap`; the rule must also cope with a raw value.
     */
    it('a value of the wrong shape or an unknown option in a raw reading is also a `gap`', () => {
      expect(
        lifecycleOf({ state: 'value', value: { type: 'option', option: 'Whatever' } }),
      ).toEqual({ state: 'undetermined', because: 'gap' });
      expect(lifecycleOf({ state: 'value', value: { type: 'text', text: 'Done' } })).toEqual({
        state: 'undetermined',
        because: 'gap',
      });
    });

    const unreadable: [Reading['state'], Reading][] = [
      ['unread', { state: 'unread', carrier: 'a carrier outside this read' }],
      ['empty', { state: 'empty' }],
      ['absent', { state: 'absent', reason: 'no carrier' }],
    ];

    it.each(unreadable)('%s is not a status', (because, reading) => {
      expect(lifecycleOf(reading)).toEqual({ state: 'undetermined', because });
    });
  });

  describe('Project status', () => {
    it.each([
      ['Planning', 'in_work'],
      ['Active', 'in_work'],
      ['Paused', 'paused'],
      ['Done', 'terminal'],
      ['Canceled', 'terminal'],
    ] as const)('%s is %s', (status, state) => {
      expect(phaseOf(records.project({ status }).readings.status)).toEqual({ state, status });
    });

    it('an unknown option is a model gap', () => {
      expect(phaseOf(records.project({ status: 'Sprint' }).readings.status)).toEqual({
        state: 'undetermined',
        because: 'gap',
      });
    });

    it('an unread status asserts nothing', () => {
      expect(phaseOf({ state: 'unread', carrier: 'x' })).toEqual({
        state: 'undetermined',
        because: 'unread',
      });
    });
  });
});
