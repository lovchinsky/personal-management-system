import { createHash } from 'node:crypto';
import { ActionEffect, effectSchema } from '../proposal.schema';
import { fingerprintOf } from './fingerprint';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';

const effect = (overrides: Record<string, unknown> = {}): ActionEffect =>
  effectSchema.parse({
    kind: 'property_write',
    pageId: PAGE,
    propertyId: 'p_task_status',
    value: { kind: 'option', option: 'Done' },
    ...overrides,
  });

describe('fingerprint of a change', () => {
  it('identical effects produce the same fingerprint', () => {
    expect(fingerprintOf([effect()])).toBe(fingerprintOf([effect()]));
  });

  /** The order of fields is not part of the change. */
  it('a different key order produces the same fingerprint', () => {
    const reordered: unknown[] = [
      {
        value: { option: 'Done', kind: 'option' },
        propertyId: 'p_task_status',
        pageId: PAGE,
        kind: 'property_write',
      },
    ];

    expect(fingerprintOf(reordered)).toBe(fingerprintOf([effect()]));
  });

  /**
   * Keys are ordered by character code, the same in every process. Ordering by locale
   * (`localeCompare`) would put `a` and `b` before `B`, and the fingerprint would depend on the
   * ICU of whoever computes it.
   */
  it('keys are sorted by character code, not by the process locale', () => {
    const effects: unknown[] = [{ b: 1, B: 2, a: 3 }];
    const expected = createHash('sha256').update('[{"B":2,"a":3,"b":1}]').digest('hex');

    expect(fingerprintOf(effects)).toBe(expected);
  });

  it('`undefined` does not change the fingerprint, because JSON has no such value', () => {
    const withUndefined: unknown[] = [{ ...effect(), extra: undefined }];

    expect(fingerprintOf(withUndefined)).toBe(fingerprintOf([effect()]));
  });

  const different: [string, ActionEffect][] = [
    ['a different page', effect({ pageId: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d' })],
    [
      'a different property',
      effect({ propertyId: 'p_task_date', value: { kind: 'date', start: '2026-10-01' } }),
    ],
    ['a different value', effect({ value: { kind: 'option', option: 'Next Action' } })],
    ['a different kind of value', effect({ value: { kind: 'clear' } })],
  ];

  it.each(different)('%s produces a different fingerprint', (_, other) => {
    expect(fingerprintOf([other])).not.toBe(fingerprintOf([effect()]));
  });

  it('the order of effects does not matter: a proposal does not write one property twice', () => {
    const date = effect({
      propertyId: 'p_task_date',
      value: { kind: 'date', start: '2026-10-01' },
    });

    expect(fingerprintOf([effect(), date])).toBe(fingerprintOf([date, effect()]));
  });
});
