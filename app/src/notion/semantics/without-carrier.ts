import { Binding } from '../binding/binding';

interface SemanticWithoutCarrier {
  readonly slot: string;
  readonly reason: string;
}

/**
 * Only the absence of a carrier is a degradation. The page body, traversal and the GBrain anchor
 * do have carriers, just not a property.
 */
export function withoutCarrier(binding: Binding): readonly SemanticWithoutCarrier[] {
  return binding.fields.flatMap(({ slot, carrier }) =>
    carrier.kind === 'absent' ? [{ slot, reason: carrier.reason }] : [],
  );
}
