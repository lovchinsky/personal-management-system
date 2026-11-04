import { OptionSet } from '../binding/binding';
import { PropertyWrite, textRuns } from '../client/property-write';
import { CanonicalWrite, CanonicalWriteKind } from './canonical-write';
import { UnwritableValueError } from './unwritable-value.error';

/**
 * The physical types each kind of canonical value accepts (`contracts/canonical.yaml`, key
 * `canonical_writes`).
 */
export const WRITABLE_TYPES: Readonly<
  Record<Exclude<CanonicalWriteKind, 'clear'>, readonly string[]>
> = {
  text: ['title', 'rich_text'],
  option: ['status', 'select'],
  date: ['date'],
  links: ['relation'],
};

/**
 * The cleared property of each physical type that can be cleared. A status does not become empty
 * when cleared, because Notion returns it to its default value. A page title is never empty.
 */
const CLEARED: ReadonlyMap<string, () => PropertyWrite> = new Map<string, () => PropertyWrite>([
  ['rich_text', () => ({ rich_text: [] })],
  ['select', () => ({ select: null })],
  ['date', () => ({ date: null })],
  ['relation', () => ({ relation: [] })],
]);

/** The physical types that can be cleared. */
export const CLEARABLE_TYPES: readonly string[] = [...CLEARED.keys()];

/**
 * Turns a canonical value into the physical shape of a request, using the type the live schema
 * reports. It mirrors `decodeProperty`: what is written here is read back there.
 */
export function encodeProperty(
  slot: string,
  write: CanonicalWrite,
  physicalType: string,
  optionSet: OptionSet | undefined,
): PropertyWrite {
  if (write.kind === 'clear') return cleared(slot, physicalType);

  if (!WRITABLE_TYPES[write.kind].includes(physicalType)) {
    throw new UnwritableValueError(
      slot,
      `a ${write.kind} value cannot be written into a ${physicalType} property`,
    );
  }

  switch (write.kind) {
    case 'text':
      return physicalType === 'title'
        ? { title: textRuns(write.text) }
        : { rich_text: textRuns(write.text) };

    case 'option': {
      const id = optionIdOf(slot, write.option, optionSet);

      return physicalType === 'status' ? { status: { id } } : { select: { id } };
    }

    case 'date':
      return { date: { start: write.start, end: write.end, time_zone: null } };

    case 'links':
      return { relation: write.pageIds.map((id) => ({ id })) };
  }
}

function cleared(slot: string, physicalType: string): PropertyWrite {
  const clear = CLEARED.get(physicalType);
  if (!clear) {
    throw new UnwritableValueError(slot, `a ${physicalType} property cannot be cleared`);
  }

  return clear();
}

/**
 * Returns the option id of a canonical name. The system never writes a non-canonical value from
 * the registry, let alone an unknown one (`docs/3-policy.md` § “Prohibited/out-of-scope
 * writes”).
 */
function optionIdOf(slot: string, option: string, optionSet: OptionSet | undefined): string {
  const canonical = optionSet?.canonical.find(([name]) => name === option);
  if (canonical) {
    return canonical[1];
  }

  if (optionSet?.knownNonCanonical.some(([name]) => name === option)) {
    throw new UnwritableValueError(slot, `${option} is not canonical and is never written`);
  }

  throw new UnwritableValueError(slot, `${option} is not a canonical option of this field`);
}
