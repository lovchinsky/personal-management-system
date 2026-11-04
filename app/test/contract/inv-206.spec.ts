import { availableNowCandidacy } from '../../src/methodology/available-now';
import { Records } from '../fixtures/methodology-records';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { adapterWith, taskWithStatus } from '../fixtures/notion-page.fixture';
import { canonical } from './contracts';

/**
 * `INV-206` **Execution model.** A Task has one of seven canonical statuses; time fields do not
 * replace the status; Available Now contains only eligible `Next Action` Tasks.
 *
 * The third clause is enforced here in its mechanical half, that is, which Task can get into
 * Available Now at all (`availableNowCandidacy`). The Project constraints are checked by
 * `app/src/methodology/available-now.spec.ts`. The concreteness, context and selectivity of the
 * set are the judgment of whoever composes Available Now and have no mechanical check.
 */
describe('INV-206', () => {
  it('there are seven canonical Task statuses', () => {
    expect(canonical.levels().L0.task_statuses).toHaveLength(7);
  });

  it('the binding names exactly the same seven', () => {
    const statuses = canonical.levels().L0.task_statuses;
    const bound = Object.keys(VALID_BINDING_FILE.options['task.status']?.canonical ?? {});

    expect(bound.sort()).toEqual([...statuses].sort());
  });

  it('only `Next Action` can be a candidate for Available Now: the other canonical statuses are filtered out', async () => {
    const records = await Records.create();
    const candidates = canonical
      .levels()
      .L0.task_statuses.filter(
        (status) =>
          availableNowCandidacy(records.task({ status }), new Map()).state === 'candidate',
      );

    expect(candidates).toEqual(['Next Action']);
  });

  it('time fields do not replace the status: the date is read and the status stays what it is', async () => {
    const adapter = await adapterWith();
    const record = adapter.decode('task', taskWithStatus('opt_next_action', 'Next Action'));

    expect(record.readings.status).toEqual({
      state: 'value',
      value: { type: 'option', option: 'Next Action' },
    });
    expect(record.readings.date.state).toBe('value');
    expect(record.readings.deadline.state).toBe('value');
  });
});
