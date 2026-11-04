import { Test } from '@nestjs/testing';
import { APIErrorCode, RequestTimeoutError } from '@notionhq/client';
import { liveSchemasOf } from '../../../test/fixtures/live-schemas.fixture';
import { notionAnswer } from '../../../test/fixtures/notion-answer.fixture';
import { TASK_STATUS_ID, VALID_BINDING_FILE } from '../../../test/fixtures/notion-mapping.fixture';
import { Binding, bindingOf } from '../binding/binding';
import { CANONICAL_TYPES } from '../binding/binding.schema';
import { LiveSchema } from '../client/live-schema';
import { SchemaMappingReader } from './schema-mapping.reader';

const binding = bindingOf(VALID_BINDING_FILE, 'fixture');
const live = liveSchemasOf(binding, (id) => `назва ${id}`);

async function readerWith(of: LiveSchema['of']): Promise<SchemaMappingReader> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SchemaMappingReader,
      { provide: Binding, useValue: binding },
      { provide: LiveSchema, useValue: { of } },
    ],
  }).compile();

  return moduleRef.get(SchemaMappingReader);
}

function taskStatusOf(wire: Awaited<ReturnType<SchemaMappingReader['read']>>): unknown {
  return wire.types
    .find((mapped) => mapped.type === 'task')
    ?.semantics.find((semantic) => semantic.slot === 'task.status')?.carrier;
}

describe('SchemaMappingReader', () => {
  it('reads the live schema of every canonical data source and supplies the names', async () => {
    const asked: string[] = [];
    const reader = await readerWith((id) => {
      asked.push(id);

      return Promise.resolve(live.get(id) ?? new Map());
    });

    const wire = await reader.read();

    expect(asked.sort()).toEqual(CANONICAL_TYPES.map((type) => binding.dataSource(type)).sort());
    expect(taskStatusOf(wire)).toEqual({
      kind: 'native',
      property_id: TASK_STATUS_ID,
      name: `назва ${TASK_STATUS_ID}`,
    });
  });

  it.each([
    ['Notion did not answer', new RequestTimeoutError()],
    ['the data source does not exist', notionAnswer(APIErrorCode.ObjectNotFound, 404)],
  ])('%s: the type has no names, the rest are named', async (_, error) => {
    const reader = await readerWith((id) =>
      id === binding.dataSource('task')
        ? Promise.reject(error)
        : Promise.resolve(live.get(id) ?? new Map()),
    );

    const wire = await reader.read();

    expect(taskStatusOf(wire)).toEqual({ kind: 'native', property_id: TASK_STATUS_ID });
    expect(
      wire.types
        .find((mapped) => mapped.type === 'project')
        ?.semantics.find((semantic) => semantic.slot === 'project.status')?.carrier,
    ).toMatchObject({ name: expect.any(String) });
  });

  it('a failure other than Notion being unreachable propagates', async () => {
    const reader = await readerWith(() => Promise.reject(new Error('defect')));

    await expect(reader.read()).rejects.toThrow('defect');
  });
});
