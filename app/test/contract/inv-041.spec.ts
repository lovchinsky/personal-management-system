import { Logger } from '@nestjs/common';
import { adapterWith, taskWithStatus } from '../fixtures/notion-page.fixture';
import { canonical } from './contracts';

/**
 * `INV-041` `Task Status = Hidden` is a technical status outside the domain: it is not mapped to
 * a canonical status, raises no error and is never written.
 *
 * “Never written” is enforced by the write path: the encoder refuses a non-canonical value
 * (`property.encoder.spec.ts`, `approvals.service.spec.ts`), and “outside the scope of detectors”
 * is enforced by the detectors. This test checks that the value is known, does not map into the
 * canon and does not raise a model gap.
 */
describe('INV-041', () => {
  it('the registry and the canonical set do not overlap', () => {
    const statuses = canonical.levels().L0.task_statuses;
    const registered = canonical.knownNonCanonical().map(({ value }) => value);

    expect(statuses.filter((status) => registered.includes(status))).toEqual([]);
  });

  it('a registered value does not map into the canon and produces no schema_gap', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const adapter = await adapterWith();

    const reading = adapter.decode('task', taskWithStatus('opt_hidden', 'Hidden')).readings.status;

    expect(reading).toEqual({ state: 'non_canonical', value: 'Hidden' });
    expect(warn).not.toHaveBeenCalled();
  });
});
