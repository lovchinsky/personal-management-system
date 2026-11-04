import { Logger } from '@nestjs/common';
import { AdapterConfigurationError } from '../../src/notion/semantics/adapter.error';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { TASK_STATUS_SPELLED } from '../fixtures/notion-mapping.fixture';
import {
  adapterWith,
  misbound,
  optionProperty,
  pageFor,
  taskWithStatus,
  without,
} from '../fixtures/notion-page.fixture';

/**
 * `INV-001` An unknown status value yields `schema_gap`; a nonexistent id in the binding yields
 * `configuration_error`. No default is substituted.
 *
 * The third kind in the vocabulary, `ambiguous_input`, is not covered here. Ambiguity lives in the
 * person's phrasing, the model resolves it (`INV-007`), and there is no model-free check for it.
 */
describe('INV-001', () => {
  let adapter: SemanticAdapter;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    adapter = await adapterWith();
  });

  it('a canonical value maps', () => {
    const record = adapter.decode('task', taskWithStatus('opt_scheduled', 'Scheduled'));

    expect(record.readings.status).toEqual({
      state: 'value',
      value: { type: 'option', option: 'Scheduled' },
    });
  });

  it('an unknown value yields `schema_gap` and substitutes no default', () => {
    const reading = adapter.decode('task', taskWithStatus('opt_unknown', 'Blocked')).readings
      .status;

    expect(reading.state).toBe('gap');
    expect(reading).not.toHaveProperty('value');
  });

  it('an unknown value does not stop the reading of the rest of the record', () => {
    const record = adapter.decode('task', taskWithStatus('opt_unknown', 'Blocked'));

    expect(record.readings.name.state).toBe('value');
    expect(record.readings.deadline.state).toBe('value');
  });

  it('a nonexistent id in the binding yields `configuration_error`', () => {
    const page = without(pageFor('task'), TASK_STATUS_SPELLED);

    expect(() => adapter.decode('task', page)).toThrow(AdapterConfigurationError);
  });

  it('the error names the slot and the id that the binding named', () => {
    const page = without(pageFor('task'), TASK_STATUS_SPELLED);

    // The error shows the spelling of the binding file, not the canonical form, because the
    // person will fix the file.
    expect(misbound(() => adapter.decode('task', page))).toEqual([
      expect.objectContaining({ slot: 'task.status', named: TASK_STATUS_SPELLED }),
    ]);
  });

  it('an unknown option of a field with a closed set yields `schema_gap` likewise', () => {
    const page = pageFor('area_of_focus', {
      p_area_of_focus_mode: optionProperty('p_area_of_focus_mode', 'opt_unknown', 'Sprint'),
    });

    expect(adapter.decode('area_of_focus', page).readings.mode.state).toBe('gap');
  });
});
