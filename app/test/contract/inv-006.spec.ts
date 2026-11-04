import { InboxConversionRequest } from '../../src/capture/inbox-conversion.schema';
import { availableNowCandidacy } from '../../src/methodology/available-now';
import { propertyIdFromCanonical } from '../../src/notion/client/property-id';
import { CanonicalWrite } from '../../src/notion/semantics/canonical-write';
import { CAPTURING } from '../fixtures/actors';
import { A_CONVERSION, CaptureWorld } from '../fixtures/capture-world';
import { Records, taskPageOf } from '../fixtures/methodology-records';
import { adapterWith, taskWithStatus } from '../fixtures/notion-page.fixture';

type Task = InboxConversionRequest['task'];

/**
 * Returns the Task a conversion created: the properties that reached Notion in the write, with
 * the status given as an option id.
 */
async function created(task: Task): Promise<Record<string, unknown>> {
  const world = new CaptureWorld();
  const service = await world.service();

  await service.convert(await service.check(CAPTURING, { ...A_CONVERSION, task }), () => undefined);

  const page = world.writes.find((call) => call.op === 'createPage');

  return page?.op === 'createPage' ? { ...page.properties } : {};
}

/**
 * `INV-006` The presence of a `Deadline` does not change the status. A `Next Action` with a
 * `Deadline` remains `Next Action`.
 */
describe('INV-006', () => {
  const name = 'Подати декларацію';
  const deadline = '2026-12-15';
  const DEADLINE_ID = propertyIdFromCanonical('p_task_deadline');
  const DEADLINE: CanonicalWrite = { kind: 'date', start: deadline, end: null };

  it('a conversion with a deadline writes the same status as without one and writes no `Date`', async () => {
    const without = await created({ name, status: 'Next Action' });
    const dated = await created({ name, status: 'Next Action', deadline });

    expect(dated['p_task%7Bstatus']).toEqual({ status: { id: 'opt_next_action' } });
    expect(dated['p_task%7Bstatus']).toEqual(without['p_task%7Bstatus']);
    expect(dated['p_task_deadline']).toEqual({
      date: { start: deadline, end: null, time_zone: null },
    });
    expect(dated['p_task_date']).toBeUndefined();
  });

  /**
   * Writing a deadline to an existing Task touches neither the status nor `Date`, because the
   * request has one property. The write rule does not refuse that request, including on a page
   * where the person has left a date on `Next Action` themselves.
   */
  it.each([
    ['without a date', taskPageOf({ status: 'Next Action' })],
    ['with a date the person left', taskPageOf({ status: 'Next Action', date: '2026-10-01' })],
  ])('a deadline on an existing Next Action %s is written as a single field', async (_, page) => {
    const adapter = await adapterWith();

    expect(Object.keys(adapter.encodeOn(page, new Map([[DEADLINE_ID, DEADLINE]])))).toEqual([
      'p_task_deadline',
    ]);
  });

  it('a Task that has a deadline is read with the same status as without one', async () => {
    const adapter = await adapterWith();
    const record = adapter.decode('task', taskWithStatus('opt_next_action', 'Next Action'));

    expect(record.readings.deadline.state).toBe('value');
    expect(record.readings.status).toEqual({
      state: 'value',
      value: { type: 'option', option: 'Next Action' },
    });
  });

  /**
   * A deadline does not take a Next Action out of Available Now, because it is the status that
   * makes it a candidate.
   */
  it('a Next Action with a deadline stays an Available Now candidate, as without one', async () => {
    const records = await Records.create();

    expect(availableNowCandidacy(records.task({ status: 'Next Action' }), new Map())).toEqual({
      state: 'candidate',
    });
    expect(
      availableNowCandidacy(records.task({ status: 'Next Action', deadline }), new Map()),
    ).toEqual({ state: 'candidate' });
  });
});
