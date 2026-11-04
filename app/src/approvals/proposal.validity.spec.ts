import { CanonicalWriteRequest } from '../notion/semantics/canonical-write';
import { PreconditionRequest, preconditionsSchema } from './preconditions/precondition';
import { ActionEffectRequest, effectsSchema } from './proposal.schema';
import { ProposalDefect, validateProposal } from './proposal.validity';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const OTHER_PAGE = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const STATUS = 'p_task_status';
const DATE = 'p_task_date';

const DONE: CanonicalWriteRequest = { kind: 'option', option: 'Done' };

const write = (
  propertyId: string,
  value: CanonicalWriteRequest,
  pageId = PAGE,
): ActionEffectRequest => ({ kind: 'property_write', pageId, propertyId, value });

const equals = (propertyId: string, pageId = PAGE): PreconditionRequest => ({
  kind: 'property_equals',
  pageId,
  propertyId,
  optionId: 'opt_next_action',
});

const empty = (propertyId: string, pageId = PAGE): PreconditionRequest => ({
  kind: 'property_empty',
  pageId,
  propertyId,
});

const reads = (
  propertyId: string,
  value: CanonicalWriteRequest,
  pageId = PAGE,
): PreconditionRequest => ({ kind: 'property_reads_as', pageId, propertyId, value });

/**
 * Returns the validity defects by kind, or `[]` when the proposal is executable. Effects and
 * preconditions are parsed by the same schemas that parse a proposal's input and the executor's
 * row.
 */
function defectsOf(
  effects: readonly ActionEffectRequest[],
  preconditions: readonly PreconditionRequest[],
): readonly ProposalDefect['kind'][] {
  const validity = validateProposal(
    effectsSchema.parse(effects),
    preconditionsSchema.parse(preconditions),
  );

  return validity.valid ? [] : validity.defects.map((defect) => defect.kind);
}

/**
 * The validity rule is one function, checked twice: at the time of the proposal and at the time of
 * execution (`contracts/canonical.yaml`, key `pending_action`).
 */
describe('proposal validity', () => {
  /**
   * Once-only execution is enforced by a precondition that sees this particular write.
   * `property_equals` compares the option id, so it sees only an option write or its clearing;
   * `property_empty` sees a value written into an empty property; `property_reads_as` sees a write
   * of any kind over the value the precondition names, if the effect changes that value.
   */
  describe('a precondition that sees a write', () => {
    const cases: [string, ActionEffectRequest, PreconditionRequest, boolean][] = [
      ['`property_equals` sees an option write', write(STATUS, DONE), equals(STATUS), true],
      ['`property_equals` sees clearing', write(STATUS, { kind: 'clear' }), equals(STATUS), true],
      [
        '`property_empty` sees an option written into an empty property',
        write(STATUS, DONE),
        empty(STATUS),
        true,
      ],
      [
        '`property_empty` sees a date written into an empty property',
        write(DATE, { kind: 'date', start: '2026-10-01' }),
        empty(DATE),
        true,
      ],
      [
        '`property_equals` does not see a date written over a filled property',
        write(DATE, { kind: 'date', start: '2026-10-01' }),
        equals(DATE),
        false,
      ],
      [
        '`property_empty` does not see clearing',
        write(DATE, { kind: 'clear' }),
        empty(DATE),
        false,
      ],
      ['a precondition on another property sees nothing', write(STATUS, DONE), empty(DATE), false],
      [
        'a precondition on another page sees nothing',
        write(STATUS, DONE),
        equals(STATUS, OTHER_PAGE),
        false,
      ],
      [
        'a precondition on the value it reads sees a filled date written over another date',
        write(DATE, { kind: 'date', start: '2026-10-01' }),
        reads(DATE, { kind: 'date', start: '2026-09-25' }),
        true,
      ],
      [
        'a precondition on the old text sees a text change',
        write(DATE, { kind: 'text', text: 'новий' }),
        reads(DATE, { kind: 'text', text: 'старий' }),
        true,
      ],
      [
        'a precondition on the old set of relations sees a change of relations',
        write(DATE, { kind: 'links', pageIds: [OTHER_PAGE] }),
        reads(DATE, { kind: 'links', pageIds: [PAGE] }),
        true,
      ],
      [
        'a precondition on the value that was there sees clearing',
        write(DATE, { kind: 'clear' }),
        reads(DATE, { kind: 'date', start: '2026-09-25' }),
        true,
      ],
      [
        'a precondition does not see a write of the same value, so a retry would pass',
        write(DATE, { kind: 'date', start: '2026-09-25' }),
        reads(DATE, { kind: 'date', start: '2026-09-25' }),
        false,
      ],
      [
        'the same instant spelled differently is the same value',
        write(DATE, { kind: 'date', start: '2026-09-25T09:00:00+03:00' }),
        reads(DATE, { kind: 'date', start: '2026-09-25T06:00:00.000Z' }),
        false,
      ],
      [
        'the same relations in a different order are the same value',
        write(DATE, { kind: 'links', pageIds: [PAGE, OTHER_PAGE] }),
        reads(DATE, { kind: 'links', pageIds: [OTHER_PAGE, PAGE] }),
        false,
      ],
      [
        'a precondition on the value of another property sees nothing',
        write(STATUS, DONE),
        reads(DATE, { kind: 'date', start: '2026-09-25' }),
        false,
      ],
      [
        '`unchanged_since` does not see its own write in the same minute',
        write(STATUS, DONE),
        { kind: 'unchanged_since', pageId: PAGE, lastEditedTime: '2026-09-24T08:00:00.000Z' },
        false,
      ],
    ];

    it.each(cases)('%s', (_, effect, precondition, observed) => {
      const expected: readonly ProposalDefect['kind'][] = observed ? [] : ['unobserved'];

      expect(defectsOf([effect], [precondition])).toEqual(expected);
    });
  });

  /**
   * The row schema does not let an empty list of effects through; the proposal schema passes it on
   * to the rule.
   */
  it('a proposal with no effect is a defect', () => {
    const expected: ProposalDefect[] = [{ kind: 'no_effect' }];

    expect(validateProposal([], preconditionsSchema.parse([equals(STATUS)]))).toEqual({
      valid: false,
      defects: expected,
    });
  });

  it('two objects cannot be changed by one write', () => {
    expect(
      defectsOf(
        [write(STATUS, DONE), write(STATUS, DONE, OTHER_PAGE)],
        [equals(STATUS), equals(STATUS, OTHER_PAGE)],
      ),
    ).toEqual(['many_subjects']);
  });

  /**
   * There is a single write, and only one of the two values would survive in it, not necessarily
   * the one the person considered the main value.
   */
  it('two changes to one property are a defect, and the last one does not win', () => {
    const effects = [write(STATUS, DONE), write(STATUS, { kind: 'option', option: 'Canceled' })];
    const validity = validateProposal(
      effectsSchema.parse(effects),
      preconditionsSchema.parse([equals(STATUS)]),
    );
    const expected: ProposalDefect[] = [{ kind: 'repeated_property', propertyIds: [STATUS] }];

    expect(validity).toEqual({ valid: false, defects: expected });
  });

  it('the same property on different pages is not a repeat', () => {
    expect(
      defectsOf(
        [write(STATUS, DONE), write(STATUS, DONE, OTHER_PAGE)],
        [equals(STATUS), equals(STATUS, OTHER_PAGE)],
      ),
    ).not.toContain('repeated_property');
  });

  /**
   * The form of an id in a proposal is not guessed: the model sees only canonical ids, and decoding
   * is not idempotent. An id that looks encoded is refused at once, with the fault named, instead
   * of a `conflict` after approval, when the property would not be found.
   */
  it('an encoded property id is refused for its form', () => {
    const encoded = effectsSchema.safeParse([write('HZN%60', DONE)]);

    expect(encoded.error?.issues.map((issue) => issue.message)).toEqual([
      'property id looks percent-encoded; proposals carry canonical ids',
    ]);
  });

  it('an executable proposal names the page of the write', () => {
    const validity = validateProposal(
      effectsSchema.parse([write(STATUS, DONE, PAGE.replaceAll('-', '').toUpperCase())]),
      preconditionsSchema.parse([equals(STATUS)]),
    );

    expect(validity).toEqual({ valid: true, subject: PAGE });
  });
});
