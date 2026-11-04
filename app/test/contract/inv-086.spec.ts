import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rawNotionUrlsIn, writeCallsIn } from './notion-writes';
import { shippedSources, SRC, within } from './sources';

const WRITER = resolve(SRC, 'notion/client/notion.writer.ts');
const WORKSPACE = resolve(SRC, 'notion/workspace');

/**
 * The tails of the call chains through which `notion/workspace/` writes the schema: databases and
 * data sources, not pages.
 */
const SCHEMA_WRITES: readonly string[] = [
  'dataSources.update',
  'databases.create',
  'databases.update',
];

/**
 * `INV-086` Only `NotionWriter` calls the Notion write endpoints (comment, page creation and
 * update, trash); it is one boundary that receives values already encoded by the adapter and
 * checks the author of the response. Only `notion/workspace/` writes the schema — databases and
 * data sources — and the running App does not load it (`INV-081`).
 */
describe('INV-086', () => {
  const files = shippedSources(SRC);

  it('no file except the write boundary and notion/workspace/ writes to Notion', () => {
    const outside = files
      .filter((file) => file !== WRITER && !within(WORKSPACE, file))
      .flatMap((file) => writeCallsIn(file, readFileSync(file, 'utf8')))
      .map((call) => `${call.at} ${call.chain}`);

    expect(outside).toEqual([]);
  });

  it('notion/workspace/ writes only the schema: databases and data sources, not pages', () => {
    const calls = files
      .filter((file) => within(WORKSPACE, file))
      .flatMap((file) => writeCallsIn(file, readFileSync(file, 'utf8')));
    const notSchema = calls.filter(
      (call) => !SCHEMA_WRITES.some((tail) => call.chain.endsWith(`.${tail}`)),
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(notSchema.map((call) => `${call.at} ${call.chain}`)).toEqual([]);
  });

  it('nobody calls the Notion REST API bypassing the client', () => {
    const raw = files.flatMap((file) => rawNotionUrlsIn(file, readFileSync(file, 'utf8')));

    expect(raw).toEqual([]);
  });

  /** Otherwise a blind detector would pass the check above silently. */
  it('finds the calls it checks', () => {
    const inWriter = writeCallsIn(WRITER, readFileSync(WRITER, 'utf8')).map((call) => call.chain);
    const probe = writeCallsIn(
      'probe.ts',
      'client.blocks.children.append({ block_id: "x", children: [] }); n.dataSources.update({});',
    ).map((call) => call.chain);

    expect(inWriter).toEqual(
      expect.arrayContaining([
        'notion.comments.create',
        'notion.pages.create',
        'notion.pages.update',
      ]),
    );
    expect(probe).toEqual(['client.blocks.children.append', 'n.dataSources.update']);
    expect(rawNotionUrlsIn('probe.ts', 'fetch(`https://api.notion.com/v1/pages`)')).toHaveLength(1);
  });
});
