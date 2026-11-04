import { CAPTURING } from '../fixtures/actors';
import {
  A_CONVERSION,
  ANOTHER_TASK,
  CaptureWorld,
  converted,
  INBOX_ITEM,
  PROJECT,
} from '../fixtures/capture-world';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';

/**
 * `SCEN-12-05` The `capture-scope violation rate` is measured. The violations are writes from the
 * capture path outside `capture_policy`: a write to a data source other than Tasks, or an update
 * instead of a create.
 *
 * On the system's path the metric is mechanical: the App's conversion creates only a Task in
 * Tasks and updates no existing page, and it moves only the Inbox item itself to the trash.
 */
describe('SCEN-12-05', () => {
  it('all conversion writes are within capture_policy', async () => {
    const world = new CaptureWorld();
    const service = await world.service();
    const linked = {
      ...A_CONVERSION,
      task: { ...A_CONVERSION.task, project: [PROJECT], dependencies: [ANOTHER_TASK] },
    };

    await converted(service, await service.check(CAPTURING, linked));

    const outOfScope = world.writes.filter(
      (call) =>
        (call.op === 'createPage' && call.dataSourceId !== VALID_BINDING_FILE.data_sources.task) ||
        call.op === 'updateProperties' ||
        (call.op === 'archive' && call.pageId !== INBOX_ITEM),
    );

    expect(outOfScope).toEqual([]);
    expect(world.writes.map((call) => call.op)).toEqual(['createPage', 'comment', 'archive']);
  });

  it('the conversion does not accept a page outside the Inbox', async () => {
    const service = await new CaptureWorld().service();

    await expect(
      service.check(CAPTURING, { ...A_CONVERSION, inboxPageId: PROJECT }),
    ).rejects.toThrow('is not an Inbox item');
  });
});
