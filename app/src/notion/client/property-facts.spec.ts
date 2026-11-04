import { run } from '../../../test/fixtures/notion-page.fixture';
import { PageProperty } from './page';
import { isEmpty, Observed, optionIdOf } from './property-facts';
import { propertyIdFromCanonical } from './property-id';

const id = propertyIdFromCanonical('p_fact');
const option = { id: 'opt-1', name: 'Next Action', color: 'default' } as const;

interface Case {
  readonly name: string;
  readonly property: PageProperty;
  readonly empty: Observed<boolean>;
}

const known = (value: boolean): Observed<boolean> => ({ known: true, value });

/**
 * A characterization of what a precondition sees in each property type. The table records the
 * behavior exactly, including the behavior that deliberately differs from the decoder: here a
 * text of only spaces is not empty, and an empty list of relations is empty.
 */
const CASES: Case[] = [
  { name: 'status, no option', property: { id, type: 'status', status: null }, empty: known(true) },
  {
    name: 'status with an option',
    property: { id, type: 'status', status: option },
    empty: known(false),
  },
  { name: 'select, no option', property: { id, type: 'select', select: null }, empty: known(true) },
  {
    name: 'select with an option',
    property: { id, type: 'select', select: option },
    empty: known(false),
  },
  { name: 'date without a date', property: { id, type: 'date', date: null }, empty: known(true) },
  {
    name: 'date with a date',
    property: { id, type: 'date', date: { start: '2026-09-25', end: null, time_zone: null } },
    empty: known(false),
  },
  {
    name: 'empty relation',
    property: { id, type: 'relation', relation: [] },
    empty: known(true),
  },
  {
    name: 'relation with a reference',
    property: { id, type: 'relation', relation: [{ id: 'page-2' }] },
    empty: known(false),
  },
  {
    name: 'empty rich_text',
    property: { id, type: 'rich_text', rich_text: [] },
    empty: known(true),
  },
  {
    name: 'rich_text of only spaces',
    property: { id, type: 'rich_text', rich_text: [run('   ')] },
    empty: known(false),
  },
  {
    name: 'rich_text with an empty fragment',
    property: { id, type: 'rich_text', rich_text: [run('')] },
    empty: known(false),
  },
  { name: 'empty title', property: { id, type: 'title', title: [] }, empty: known(true) },
  {
    name: 'title with text',
    property: { id, type: 'title', title: [run('задача')] },
    empty: known(false),
  },
  { name: 'number, no value', property: { id, type: 'number', number: null }, empty: known(true) },
  { name: 'number zero', property: { id, type: 'number', number: 0 }, empty: known(false) },
  {
    name: 'checkbox unchecked',
    property: { id, type: 'checkbox', checkbox: false },
    empty: known(true),
  },
  {
    name: 'checkbox checked',
    property: { id, type: 'checkbox', checkbox: true },
    empty: known(false),
  },
  { name: 'empty people', property: { id, type: 'people', people: [] }, empty: known(true) },
  {
    name: 'people with a person',
    property: { id, type: 'people', people: [{ object: 'user', id: 'user-1' }] },
    empty: known(false),
  },
  {
    name: 'empty multi_select',
    property: { id, type: 'multi_select', multi_select: [] },
    empty: known(true),
  },
  {
    name: 'multi_select with an option',
    property: { id, type: 'multi_select', multi_select: [option] },
    empty: known(false),
  },
  { name: 'empty url', property: { id, type: 'url', url: null }, empty: known(true) },
  { name: 'filled url', property: { id, type: 'url', url: 'https://x' }, empty: known(false) },
  { name: 'empty email', property: { id, type: 'email', email: null }, empty: known(true) },
  {
    name: 'filled email',
    property: { id, type: 'email', email: 'a@b.c' },
    empty: known(false),
  },
  {
    name: 'empty phone_number',
    property: { id, type: 'phone_number', phone_number: null },
    empty: known(true),
  },
  {
    name: 'filled phone_number',
    property: { id, type: 'phone_number', phone_number: '+380' },
    empty: known(false),
  },
  { name: 'empty files', property: { id, type: 'files', files: [] }, empty: known(true) },
  {
    name: 'files with a file',
    property: {
      id,
      type: 'files',
      files: [{ name: 'f', type: 'external', external: { url: 'https://x' } }],
    },
    empty: known(false),
  },
];

/** Nobody fills in a computed property: the question of emptiness has no answer for it. */
const COMPUTED: PageProperty[] = [
  { id, type: 'formula', formula: { type: 'number', number: 3 } },
  { id, type: 'created_time', created_time: '2026-09-24T08:00:00.000Z' },
];

describe('what a precondition sees in a Notion property', () => {
  it.each(CASES)('$name', ({ property, empty }) => {
    expect(isEmpty(property)).toEqual(empty);
  });

  it.each(COMPUTED)('the question of emptiness has no answer for a $type property', (property) => {
    expect(isEmpty(property).known).toBe(false);
  });

  it('only `status` and `select` have an option', () => {
    const answers: Observed<string | null>[] = [
      optionIdOf({ id, type: 'status', status: option }),
      optionIdOf({ id, type: 'select', select: null }),
    ];
    const expected: Observed<string | null>[] = [
      { known: true, value: 'opt-1' },
      { known: true, value: null },
    ];

    expect(answers).toEqual(expected);
    expect(optionIdOf({ id, type: 'date', date: null }).known).toBe(false);
  });
});
