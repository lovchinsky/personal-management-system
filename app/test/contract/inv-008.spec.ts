import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BODY_FIELDS, writeCallsIn } from './notion-writes';
import { SRC } from './sources';

const WRITER = resolve(SRC, 'notion/client/notion.writer.ts');

/**
 * `INV-008` The App does not write to the page body — neither the parser nor system writes do.
 * The person changes the body, on their own or through Claude in the chat.
 *
 * The invariant is checked mechanically over the single write boundary (`INV-086` leaves no
 * other). The boundary calls no block endpoint and sends no page body field.
 */
describe('INV-008', () => {
  const calls = writeCallsIn(WRITER, readFileSync(WRITER, 'utf8'));

  it('the write boundary does not touch blocks', () => {
    expect(calls.filter((call) => call.chain.includes('blocks')).map((call) => call.at)).toEqual(
      [],
    );
  });

  it('page requests contain no body fields', () => {
    const body = calls.flatMap((call) =>
      call.fields
        .filter((field) => BODY_FIELDS.includes(field))
        .map((field) => `${call.at} ${field}`),
    );

    expect(body).toEqual([]);
  });

  /** Without this test, a detector that sees no fields would pass the check above silently. */
  it('finds the request fields it checks', () => {
    const [probe] = writeCallsIn(
      'probe.ts',
      'this.notion.pages.create({ parent: {}, properties: {}, children: [] });',
    );

    expect(probe.fields).toEqual(['parent', 'properties', 'children']);
    expect(calls.map((call) => call.fields).flat()).toEqual(
      expect.arrayContaining(['page_id', 'properties', 'in_trash']),
    );
  });
});
