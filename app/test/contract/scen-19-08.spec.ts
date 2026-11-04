import { InboxConversionRequest } from '../../src/capture/inbox-conversion.schema';
import { CAPTURING } from '../fixtures/actors';
import { A_CONVERSION, CaptureWorld, converted } from '../fixtures/capture-world';

type Task = InboxConversionRequest['task'];

/** Carries a conversion through to the end and returns what reached Notion and its step names. */
async function convertedWith(task: Task): Promise<{
  readonly properties: Record<string, unknown>;
  readonly steps: readonly string[];
}> {
  const world = new CaptureWorld();
  const service = await world.service();
  const { steps } = await converted(
    service,
    await service.check(CAPTURING, { ...A_CONVERSION, task }),
  );
  const page = world.writes.find((call) => call.op === 'createPage');

  return {
    properties: page?.op === 'createPage' ? { ...page.properties } : {},
    steps: steps.map((step) => step.step),
  };
}

/**
 * `SCEN-19-08` A future activation without a hard appointment yields a `Scheduled` Task;
 * a Calendar entry is not required.
 */
describe('SCEN-19-08', () => {
  const task: Task = { name: 'Зателефонувати лікарю', status: 'Scheduled', date: '2026-10-08' };

  it('a `Scheduled` Task has `Date` and no `Deadline`', async () => {
    const { properties } = await convertedWith(task);

    expect(properties['p_task%7Bstatus']).toEqual({ status: { id: 'opt_scheduled' } });
    expect(properties['p_task_date']).toEqual({
      date: { start: '2026-10-08', end: null, time_zone: null },
    });
    expect(properties['p_task_deadline']).toBeUndefined();
  });

  /**
   * The system does not write to Calendar: a conversion creates a Task, adds an origin comment and
   * moves the item to the trash, and does nothing else.
   */
  it('no write to Calendar: only a Task, an origin comment and the trash', async () => {
    const { steps } = await convertedWith(task);

    expect(steps).toEqual(['task_created', 'origin_noted', 'item_archived']);
  });

  it.each(['Waiting For', 'Someday/Maybe'] as const)(
    'the reminder time also stays in `Date` for status %s',
    async (status) => {
      const { properties } = await convertedWith({ ...task, status });

      expect(properties['p_task_date']).toBeDefined();
    },
  );
});
