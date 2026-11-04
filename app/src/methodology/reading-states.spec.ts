import { Records } from '../../test/fixtures/methodology-records';
import { MATRIX, READINGS, type StateName } from '../../test/fixtures/reading-matrix';

/**
 * Every rule over every reading state of every field it reads. An unread, absent or unknown field
 * does not become “nothing”; `empty` is “none” where the field is optional, and `Hidden`
 * (`non_canonical`) does not exist for the domain (`out_of_scope`). The expectations in the table
 * are written as literals from the rules' semantics, and the records are real, from the adapter,
 * with one reading overridden.
 */
describe('methodology rules over reading states', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  const STATES: readonly StateName[] = ['absent', 'unread', 'gap', 'non_canonical', 'empty'];

  const cases = MATRIX.flatMap((row) =>
    STATES.map((state) => ({
      title: `${row.rule}(${row.field}) ← ${state}`,
      row,
      reading: READINGS[state],
      expected: row.expected[state],
    })),
  );

  it.each(cases)('$title', ({ row, reading, expected }) => {
    expect(row.run(records, reading)).toEqual(expected);
  });

  const extras = MATRIX.flatMap((row) =>
    Object.entries(row.extra ?? {}).map(([name, extra]) => ({
      title: `${row.rule}(${row.field}) ← ${name}`,
      row,
      ...extra,
    })),
  );

  it.each(extras)('$title', ({ row, reading, expected }) => {
    expect(row.run(records, reading)).toEqual(expected);
  });
});
