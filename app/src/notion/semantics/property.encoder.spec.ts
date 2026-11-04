import { echoOf } from '../../../test/fixtures/notion-echo.fixture';
import { VALID_BINDING_FILE } from '../../../test/fixtures/notion-mapping.fixture';
import { bindingOf, OptionSet } from '../binding/binding';
import { canonicalPage, PageProperty } from '../client/page';
import { propertyIdFromNotion } from '../client/property-id';
import { PropertyWrite, TEXT_RUN_CHARS } from '../client/property-write';
import { CanonicalWrite, canonicalWriteSchema, confirmsWrite } from './canonical-write';
import { decodeProperty } from './property.decoder';
import { CLEARABLE_TYPES, encodeProperty, WRITABLE_TYPES } from './property.encoder';
import { UnwritableValueError } from './unwritable-value.error';

const SLOT = 'task.status';
const OPTIONS: OptionSet | undefined = bindingOf(VALID_BINDING_FILE, 'fixture').optionSet(SLOT);

/** Builds the property Notion would return for this write, in the canonical form of a page. */
function echoed(write: PropertyWrite): PageProperty {
  const page = canonicalPage({
    in_trash: false,
    parent: { type: 'workspace', workspace: true },
    id: 'page-1',
    last_edited_time: '2026-09-29T10:00:00.000Z',
    properties: { written: echoOf('p', write) },
  });
  const property = page.properties.get(propertyIdFromNotion('p'));

  if (!property) {
    throw new Error('the echo lost its property');
  }

  return property;
}

/**
 * Writes and reads back with the same adapter: what was read must be what was written
 * (`contracts/canonical.yaml`, key `canonical_writes`).
 */
function roundTrip(write: CanonicalWrite, physicalType: string): boolean {
  const property = echoed(encodeProperty(SLOT, write, physicalType, OPTIONS));
  const result = decodeProperty(SLOT, property, OPTIONS, 'p');

  if (!result.ok) {
    throw new Error(result.problem.detail);
  }

  return confirmsWrite(write, result.reading);
}

const write = (request: unknown): CanonicalWrite => canonicalWriteSchema.parse(request);

/**
 * Checks whether the write went through: an encoder refusal returns `false`, any other error
 * propagates.
 */
function outcomeOf(encode: () => PropertyWrite): boolean {
  try {
    encode();

    return true;
  } catch (error) {
    if (error instanceof UnwritableValueError) return false;

    throw error;
  }
}

describe('encoding a property write', () => {
  const cases: [string, CanonicalWrite, string][] = [
    ['text into the title', write({ kind: 'text', text: 'Подзвонити в банк' }), 'title'],
    ['text into rich_text', write({ kind: 'text', text: 'Нотатка' }), 'rich_text'],
    [
      'long text in runs',
      write({ kind: 'text', text: '😀'.repeat(TEXT_RUN_CHARS + 7) }),
      'rich_text',
    ],
    ['an option into a status', write({ kind: 'option', option: 'Next Action' }), 'status'],
    ['an option into select', write({ kind: 'option', option: 'Waiting For' }), 'select'],
    ['a date', write({ kind: 'date', start: '2026-10-01' }), 'date'],
    ['a zoned instant', write({ kind: 'date', start: '2026-10-01T10:00:00+03:00' }), 'date'],
    ['an interval', write({ kind: 'date', start: '2026-10-01', end: '2026-10-03' }), 'date'],
    [
      'a list of relations',
      write({ kind: 'links', pageIds: ['1F2E3D4C5B6A49788A9B0C1D2E3F4A5B'] }),
      'relation',
    ],
    ['an empty list of relations', write({ kind: 'links', pageIds: [] }), 'relation'],
    ...CLEARABLE_TYPES.map((type): [string, CanonicalWrite, string] => [
      `clearing ${type}`,
      write({ kind: 'clear' }),
      type,
    ]),
  ];

  it.each(cases)('%s is read back as what was written', (_, value, physicalType) => {
    expect(roundTrip(value, physicalType)).toBe(true);
  });

  /**
   * Without this test the check above would accept anything, even a `confirmsWrite` that always
   * says “yes”.
   */
  it('something other than what was written does not count as read back', () => {
    const property = echoed(
      encodeProperty(SLOT, write({ kind: 'text', text: 'A' }), 'title', OPTIONS),
    );
    const result = decodeProperty(SLOT, property, OPTIONS, 'p');

    expect(result.ok && confirmsWrite(write({ kind: 'text', text: 'B' }), result.reading)).toBe(
      false,
    );
  });

  it('each kind fits only its own types', () => {
    const kinds = Object.keys(WRITABLE_TYPES).filter(
      (kind): kind is keyof typeof WRITABLE_TYPES => kind in WRITABLE_TYPES,
    );
    const types = [
      ...kinds.flatMap((kind) => WRITABLE_TYPES[kind]),
      'formula',
      'rollup',
      'created_time',
      'people',
    ];
    const values: Record<keyof typeof WRITABLE_TYPES, CanonicalWrite> = {
      text: write({ kind: 'text', text: 'x' }),
      option: write({ kind: 'option', option: 'Done' }),
      date: write({ kind: 'date', start: '2026-10-01' }),
      links: write({ kind: 'links', pageIds: [] }),
    };
    const written = kinds.flatMap((kind) =>
      types
        .filter((type) => outcomeOf(() => encodeProperty(SLOT, values[kind], type, OPTIONS)))
        .map((type) => `${kind} → ${type}`),
    );
    const expected: string[] = kinds.flatMap((kind) =>
      WRITABLE_TYPES[kind].map((type) => `${kind} → ${type}`),
    );

    expect(written).toEqual(expected);
  });

  const refused: [string, CanonicalWrite, string, string][] = [
    [
      'a non-canonical value from the registry',
      write({ kind: 'option', option: 'Hidden' }),
      'status',
      'never written',
    ],
    [
      'a value outside the set',
      write({ kind: 'option', option: 'Blocked' }),
      'status',
      'not a canonical option',
    ],
    ['clearing a status', write({ kind: 'clear' }), 'status', 'cannot be cleared'],
    ['clearing a title', write({ kind: 'clear' }), 'title', 'cannot be cleared'],
    ['writing to a formula', write({ kind: 'text', text: 'x' }), 'formula', 'formula'],
  ];

  it.each(refused)('%s is refused with a reason', (_, value, physicalType, reason) => {
    expect(() => encodeProperty(SLOT, value, physicalType, OPTIONS)).toThrow(reason);
  });

  it('an option into a field without an option set is refused', () => {
    expect(() =>
      encodeProperty('task.name', write({ kind: 'option', option: 'Done' }), 'select', undefined),
    ).toThrow(UnwritableValueError);
  });
});
