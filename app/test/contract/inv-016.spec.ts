import { inboxConversionSchema } from '../../src/capture/inbox-conversion.schema';
import { CAPTURING } from '../fixtures/actors';
import {
  A_CONVERSION,
  ANOTHER_TASK,
  CaptureWorld,
  converted,
  KEY_RESULT,
  PROJECT,
} from '../fixtures/capture-world';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';

/**
 * `INV-016` Higher Levels and mutations of existing state keep the approval gate regardless of
 * capture_policy. A mutation of existing state is a change to a managed object; consuming an
 * Inbox item just converted within the same authorization is not one.
 */
describe('INV-016', () => {
  it('a conversion creates only a Task, in the Task database', async () => {
    const world = new CaptureWorld();
    const service = await world.service();

    await converted(service, await service.check(CAPTURING, A_CONVERSION));

    const created = world.writes.flatMap((call) =>
      call.op === 'createPage' ? [call.dataSourceId] : [],
    );

    expect(created).toEqual([VALID_BINDING_FILE.data_sources.task]);
  });

  /**
   * A relation from a new Task to an existing object is not an edit of that object: Notion adds
   * the reverse side, and no write of the conversion changes an existing page.
   */
  it('relations to existing objects do not change them', async () => {
    const world = new CaptureWorld();
    const service = await world.service();
    const linked = {
      ...A_CONVERSION,
      task: {
        ...A_CONVERSION.task,
        project: [PROJECT],
        keyResults: [KEY_RESULT],
        dependencies: [ANOTHER_TASK],
      },
    };

    await converted(service, await service.check(CAPTURING, linked));

    expect(world.writes.filter((call) => call.op === 'updateProperties')).toEqual([]);
  });

  /**
   * The conversion schema knows nothing of higher Levels or a page body, so such a request is
   * refused on shape.
   */
  it.each([
    ['a relation to a Behavior System', { behaviorSystem: [PROJECT] }],
    ['a page body', { body: 'нотатка' }],
    ['another object type', { type: 'project' }],
  ])('%s is refused on shape', (_, extra) => {
    const smuggled: Record<string, unknown> = {
      ...A_CONVERSION,
      task: { ...A_CONVERSION.task, ...extra },
    };

    expect(inboxConversionSchema.safeParse(smuggled).success).toBe(false);
  });
});
