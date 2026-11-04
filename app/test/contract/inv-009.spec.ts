import { Logger } from '@nestjs/common';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import {
  adapterWith,
  block,
  optionProperty,
  pageFor,
  textProperty,
} from '../fixtures/notion-page.fixture';

/**
 * `INV-009` An empty page body → capability `empty` for all prose semantics of this record. An
 * enum value that belongs neither to the canonical set nor to the known non-canonical register →
 * `schema_gap`.
 */
describe('INV-009', () => {
  let adapter: SemanticAdapter;

  const prose = ['meaning', 'principles', 'boundaries'] as const;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    adapter = await adapterWith();
  });

  it('an empty body makes all prose semantics of the record `empty`, not only one', () => {
    const record = adapter.decode('identity', pageFor('identity'), []);

    for (const slot of prose) expect(record.readings[slot].state).toBe('empty');
  });

  it('a non-empty body goes to every prose semantic of the record', () => {
    const record = adapter.decode('identity', pageFor('identity'), [block]);

    for (const slot of prose) expect(record.readings[slot].state).toBe('value');
  });

  it('an `unread` body is not reported as `absent`', () => {
    const record = adapter.decode('identity', pageFor('identity'));

    for (const slot of prose) expect(record.readings[slot].state).toBe('unread');
  });

  it('an `absent` carrier and an `empty` carrier are different states, not one', () => {
    const page = pageFor('inbox_item', { title: textProperty('title', '') });
    const record = adapter.decode('inbox_item', page, []);

    // The binding says there is no carrier anywhere, so nothing can be filled in.
    expect(record.readings.source).toEqual({
      state: 'absent',
      reason: 'source has no carrier',
    });

    // A carrier exists and holds nothing, so it can be filled in. For a required field an empty
    // carrier is a finding.
    expect(record.readings.captured_title).toEqual({ state: 'empty' });
  });

  it('an enum value outside both sets yields `schema_gap`', () => {
    const page = pageFor('behavior_system', {
      p_behavior_system_lifecycle: optionProperty(
        'p_behavior_system_lifecycle',
        'opt_unknown',
        'Paused',
      ),
    });

    expect(adapter.decode('behavior_system', page).readings.lifecycle.state).toBe('gap');
  });
});
