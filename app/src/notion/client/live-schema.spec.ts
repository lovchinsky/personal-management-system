import { Test } from '@nestjs/testing';
import { Client } from '@notionhq/client';
import {
  fullDataSource,
  LivePropertyConfig,
  notionWithDataSources,
  partialDataSource,
  plainProperty,
  statusProperty,
} from '../../../test/fixtures/notion-data-source.fixture';
import { LiveProperty, LiveSchema } from './live-schema';
import { propertyIdFromCanonical } from './property-id';

async function schemaOver(
  properties: readonly LivePropertyConfig[],
  full = true,
): Promise<LiveSchema> {
  const notion = notionWithDataSources((id) =>
    Promise.resolve(full ? fullDataSource(id, properties) : partialDataSource(id)),
  );
  const moduleRef = await Test.createTestingModule({
    providers: [LiveSchema, { provide: Client, useValue: notion }],
  }).compile();

  return moduleRef.get(LiveSchema);
}

describe('LiveSchema', () => {
  /** An id from REST is percent-encoded; the binding and a write compare canonical ones. */
  it('properties are keyed by canonical id, with a type and closed-set options', async () => {
    const schema = await schemaOver([
      plainProperty('title', 'Name', 'title'),
      statusProperty('p_task%7Bstatus', 'Status', ['opt_next', 'opt_done']),
      plainProperty('p_task_date', 'Date', 'date'),
    ]);
    const expected: ReadonlyMap<string, LiveProperty> = new Map([
      [propertyIdFromCanonical('title'), { type: 'title', name: 'Name', options: undefined }],
      [
        propertyIdFromCanonical('p_task{status'),
        {
          type: 'status',
          name: 'Status',
          options: ['opt_next', 'opt_done'],
          optionNames: new Map([
            ['opt_next', 'opt_next'],
            ['opt_done', 'opt_done'],
          ]),
        },
      ],
      [propertyIdFromCanonical('p_task_date'), { type: 'date', name: 'Date', options: undefined }],
    ]);

    await expect(schema.of('ds_task')).resolves.toEqual(expected);
  });

  it('the types determine how a write is encoded', async () => {
    const schema = await schemaOver([plainProperty('p_task_date', 'Date', 'date')]);

    await expect(schema.typesOf('ds_task')).resolves.toEqual(
      new Map([[propertyIdFromCanonical('p_task_date'), 'date']]),
    );
  });

  it('a partial response means the integration has no access, not an empty schema', async () => {
    const schema = await schemaOver([], false);

    await expect(schema.of('ds_task')).rejects.toThrow('no access');
  });
});
