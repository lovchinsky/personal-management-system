import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { TASK_STATUS_SPELLED } from '../fixtures/notion-mapping.fixture';
import {
  adapterWith,
  dateProperty,
  optionProperty,
  pageFor,
  taskWithStatus,
} from '../fixtures/notion-page.fixture';

/**
 * `INV-004` `Date` and `Deadline` are independent: each is read from its own property, and a Task
 * can carry both. The status determines what `Date` means, not which field is filled in.
 */
describe('INV-004', () => {
  let adapter: SemanticAdapter;

  beforeEach(async () => {
    adapter = await adapterWith();
  });

  it.each([
    ['opt_scheduled', 'Scheduled'],
    ['opt_waiting_for', 'Waiting For'],
    ['opt_someday', 'Someday/Maybe'],
    ['opt_next_action', 'Next Action'],
    ['opt_done', 'Done'],
  ])('both fields are read under the status %s', (optionId, name) => {
    const record = adapter.decode('task', taskWithStatus(optionId, name));

    expect(record.readings.date.state).toBe('value');
    expect(record.readings.deadline.state).toBe('value');
  });

  it('one `empty` field does not make the other `empty`', () => {
    const record = adapter.decode(
      'task',
      pageFor('task', {
        [TASK_STATUS_SPELLED]: optionProperty(TASK_STATUS_SPELLED, 'opt_scheduled', 'Scheduled'),
        p_task_date: dateProperty('p_task_date', null),
      }),
    );

    expect(record.readings.date.state).toBe('empty');
    expect(record.readings.deadline.state).toBe('value');
  });
});
