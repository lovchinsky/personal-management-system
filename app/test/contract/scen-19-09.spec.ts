import { InboxConversionRequest } from '../../src/capture/inbox-conversion.schema';
import { CAPTURING } from '../fixtures/actors';
import { A_CONVERSION, CaptureWorld, converted } from '../fixtures/capture-world';
import { adapterWith, taskWithStatus } from '../fixtures/notion-page.fixture';

type Task = InboxConversionRequest['task'];

/**
 * `SCEN-19-09` (degradation `G5`) An external dependency yields a `Waiting For` Task; `Date`
 * holds the time of the check.
 *
 * The test checks the weakened form: the external side of the dependency lives in the page body,
 * so reading it yields “unread”, not a value. The acceptance row does not claim the full form.
 */
describe('SCEN-19-09', () => {
  const waiting: Task = {
    name: 'Отримати підписаний договір від Legal',
    status: 'Waiting For',
    date: '2026-10-10',
  };

  it('`Waiting For` with `Date` is a check time, not a reason to change the status', async () => {
    const world = new CaptureWorld();
    const service = await world.service();

    await converted(service, await service.check(CAPTURING, { ...A_CONVERSION, task: waiting }));

    const page = world.writes.find((call) => call.op === 'createPage');
    const properties = page?.op === 'createPage' ? page.properties : {};

    expect(properties['p_task%7Bstatus']).toEqual({ status: { id: 'opt_waiting_for' } });
    expect(properties['p_task_date']).toEqual({
      date: { start: '2026-10-10', end: null, time_zone: null },
    });
  });

  it('the external side of a dependency is in the page body: without the body it is `unread`, not `empty`', async () => {
    const adapter = await adapterWith();
    const record = adapter.decode('task', taskWithStatus('opt_waiting_for', 'Waiting For'));

    expect(record.readings.waiting_for.state).toBe('unread');
  });
});
