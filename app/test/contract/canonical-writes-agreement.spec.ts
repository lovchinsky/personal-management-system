import { CLEARABLE_TYPES, WRITABLE_TYPES } from '../../src/notion/semantics/property.encoder';
import { canonical } from './contracts';

/**
 * The physical types that each kind of canonical value accepts, and what can be cleared, are the
 * same in the encoder as in the contract (`contracts/canonical.yaml`, key `canonical_writes`). A
 * type added in only one place would silently widen or narrow what the system writes.
 */
describe('system writes and the contract', () => {
  const declared = canonical.canonicalWrites();

  it('every kind fits the same types', () => {
    expect(WRITABLE_TYPES).toEqual(declared.kinds);
  });

  it('the same types can be cleared', () => {
    expect([...CLEARABLE_TYPES].sort()).toEqual([...declared.clearable].sort());
  });
});
