import { bindingFileSchema, SIGNAL_SLOTS } from '../../src/notion/binding/binding.schema';
import { canonical } from './contracts';

/** The fields of each canonical type, as the binding schema declares them. */
const implementedFields: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(bindingFileSchema.shape.fields.shape).map(([type, block]) => [
    type,
    Object.keys(block.shape),
  ]),
);

/** The value names of each option id set, as the binding schema declares them. */
const implementedOptions: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(bindingFileSchema.shape.options.shape).map(([slot, optional]) => [
    slot,
    Object.keys(optional.unwrap().shape.canonical.shape),
  ]),
);

/**
 * The canonical model and the binding schema describe the same set of fields.
 *
 * This is not an invariant from the registry but a check of the mechanism that
 * `contracts/README.md` describes in words: the contract is the source, the schema is the
 * implementation, and a divergence must be called out. Here it fails the test instead of waiting
 * for the template to be regenerated. The set is taken from the schema itself, not from a fixture
 * that repeats it.
 */
describe('the canonical model and the binding schema', () => {
  const fieldContract = canonical.fieldContract();

  it('the canonical types match', () => {
    expect([...implementedFields.keys()]).toEqual(Object.keys(fieldContract));
  });

  it.each(Object.keys(fieldContract))('the fields of type %s match', (type) => {
    expect(implementedFields.get(type)).toEqual(Object.keys(fieldContract[type]));
  });

  /** A field with a closed set is written by the contract as `Advance | Maintain | Minimum`. */
  const enumSlots = Object.entries(fieldContract).flatMap(([type, slots]) =>
    Object.entries(slots)
      .filter(([, value]) => value.includes(' | '))
      .map(([slot, value]) => [`${type}.${slot}`, value.split(' | ')] as const),
  );

  it('fields with a closed set have exactly the option id sets that the contract has', () => {
    expect(enumSlots.length).toBeGreaterThan(0);

    for (const [slot, values] of enumSlots) {
      expect(implementedOptions.get(slot)).toEqual(values);
    }
  });

  it('there are no more option id sets than fields with a closed set', () => {
    expect([...implementedOptions.keys()].sort()).toEqual(enumSlots.map(([slot]) => slot).sort());
  });
});

describe('the canonical signals and their implementation', () => {
  it('the list of signals matches the contract', () => {
    const declared = Object.keys(canonical.signals());

    expect([...SIGNAL_SLOTS]).toEqual(declared);
  });

  it('every signal is addressed to an existing canonical type', () => {
    const types = Object.keys(canonical.fieldContract());

    for (const slot of SIGNAL_SLOTS) {
      expect(types).toContain(slot.slice(0, slot.indexOf('.')));
    }
  });
});
