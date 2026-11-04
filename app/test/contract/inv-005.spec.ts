import { InboxConversionRequest } from '../../src/capture/inbox-conversion.schema';
import { PropertyId, propertyIdFromCanonical } from '../../src/notion/client/property-id';
import { CanonicalWrite } from '../../src/notion/semantics/canonical-write';
import { UnwritableOnPageError } from '../../src/notion/semantics/unwritable-on-page.error';
import { UnwritableValueError } from '../../src/notion/semantics/unwritable-value.error';
import { CAPTURING } from '../fixtures/actors';
import { A_CONVERSION, CaptureWorld } from '../fixtures/capture-world';
import { TASK_STATUS_ID, TASK_STATUS_SPELLED } from '../fixtures/notion-mapping.fixture';
import {
  adapterWith,
  dateProperty,
  optionProperty,
  pageFor,
} from '../fixtures/notion-page.fixture';

type Task = InboxConversionRequest['task'];

/**
 * Returns the refusal that `check` raises for a conversion Task. `null` means the Task was
 * accepted. Any other error is returned unchanged.
 */
async function refusalOf(task: Task): Promise<unknown> {
  const service = await new CaptureWorld().service();

  try {
    await service.check(CAPTURING, { ...A_CONVERSION, task });

    return null;
  } catch (error) {
    return error;
  }
}

/**
 * `INV-005` After a write, a Task does not have the status `Next Action` and a `Date` at the same
 * time. `Deadline` does not depend on the status and is written to any non-terminal Task.
 *
 * The adapter enforces the rule, so the rule is the same for a conversion Task and for an
 * approved change to an existing Task. Here it is checked on the conversion Task, where both
 * halves of the rule are in the request. For that reason the refusal is a request refusal, not a
 * page refusal.
 */
describe('INV-005', () => {
  const name = 'Подзвонити в банк';
  const date = '2026-10-01';

  const refused: [string, Task][] = [
    ['a date on Next Action', { name, status: 'Next Action', date }],
  ];

  const accepted: [string, Task][] = [
    ['a date on Scheduled', { name, status: 'Scheduled', date }],
    ['a date on Waiting For', { name, status: 'Waiting For', date }],
    ['a date on Someday/Maybe', { name, status: 'Someday/Maybe', date }],
    ['a deadline on Next Action', { name, status: 'Next Action', deadline: date }],
    [
      'a deadline on Scheduled together with a date',
      { name, status: 'Scheduled', date, deadline: date },
    ],
  ];

  it.each(refused)('%s: the request is refused and the refusal names the date', async (_, task) => {
    const refusal = await refusalOf(task);

    expect(refusal).toBeInstanceOf(UnwritableValueError);
    expect(refusal).toMatchObject({ subject: 'task.date' });
  });

  it.each(accepted)('%s is accepted', async (_, task) => {
    await expect(refusalOf(task)).resolves.toBeNull();
  });
});

/**
 * The same rule applies on a page with existing data. Moving a Task that already has a planned
 * date into `Next Action` would leave a `Next Action` with a date, so such a write is refused
 * unless the date is cleared in the same write. The date lives on the page, so the refusal is a
 * page refusal. The rule leaves a write that touches neither the date nor the status untouched.
 */
describe('INV-005: data that lives on the page', () => {
  const NEXT_ACTION: CanonicalWrite = { kind: 'option', option: 'Next Action' };
  const CLEAR: CanonicalWrite = { kind: 'clear' };
  const DATE_ID = propertyIdFromCanonical('p_task_date');
  const waitingWithDate = pageFor('task', {
    [TASK_STATUS_SPELLED]: optionProperty(TASK_STATUS_SPELLED, 'opt_waiting_for', 'Waiting For'),
    p_task_date: dateProperty('p_task_date', '2026-10-10'),
  });

  it('a move into Next Action with the date left in place is refused by the page', async () => {
    const adapter = await adapterWith();

    expect(() =>
      adapter.encodeOn(waitingWithDate, new Map([[TASK_STATUS_ID, NEXT_ACTION]])),
    ).toThrow(UnwritableOnPageError);
  });

  it('a move together with clearing the date goes through', async () => {
    const adapter = await adapterWith();

    expect(() =>
      adapter.encodeOn(
        waitingWithDate,
        new Map<PropertyId, CanonicalWrite>([
          [TASK_STATUS_ID, NEXT_ACTION],
          [DATE_ID, CLEAR],
        ]),
      ),
    ).not.toThrow();
  });
});
