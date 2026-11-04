import { CAPTURING } from '../fixtures/actors';
import {
  A_CONVERSION,
  CaptureWorld,
  converted,
  CREATED_TASK,
  INBOX_ITEM,
  WriteCall,
} from '../fixtures/capture-world';

/**
 * `INV-014` A trashed Inbox item keeps its comment as an origin trail. No separate notification
 * about an autonomous conversion is sent.
 *
 * The comment lands on the item before the item goes to the trash, because afterwards Notion
 * accepts no comment. The comment mentions the Task the item became. A conversion enqueues no
 * notification: its steps are the Task, the comment and the trash, and nothing else.
 */
describe('INV-014', () => {
  it('the item gets an origin comment that mentions the Task, before it goes to the trash', async () => {
    const world = new CaptureWorld();
    const service = await world.service();

    await converted(service, await service.check(CAPTURING, A_CONVERSION));

    const expected: WriteCall[] = [
      {
        op: 'comment',
        target: { pageId: INBOX_ITEM },
        text: A_CONVERSION.comment,
        mention: CREATED_TASK,
      },
      { op: 'archive', pageId: INBOX_ITEM },
    ];

    expect(world.writes.slice(1)).toEqual(expected);
  });

  it('a conversion enqueues no notifications', async () => {
    const world = new CaptureWorld();
    const service = await world.service();

    const done = await converted(service, await service.check(CAPTURING, A_CONVERSION));

    expect(done.steps.map((step) => step.step)).toEqual([
      'task_created',
      'origin_noted',
      'item_archived',
    ]);
  });
});
