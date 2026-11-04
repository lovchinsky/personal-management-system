import { VALID_BINDING_FILE } from '../../../test/fixtures/notion-mapping.fixture';
import { bindingOf } from '../binding/binding';
import { withoutCarrier } from './without-carrier';

describe('semantics without a carrier', () => {
  const binding = bindingOf(VALID_BINDING_FILE, 'fixture');

  it('only the absence of a carrier counts as a degradation', () => {
    expect(withoutCarrier(binding)).toEqual([
      { slot: 'objective.why_now', reason: 'why_now has no carrier' },
      { slot: 'objective.time_horizon', reason: 'time_horizon has no carrier' },
      { slot: 'objective.review_notes', reason: 'review_notes has no carrier' },
      { slot: 'inbox_item.captured_text', reason: 'captured_text has no carrier' },
      { slot: 'inbox_item.source', reason: 'source has no carrier' },
      { slot: 'inbox_item.clarified_at', reason: 'clarified_at has no carrier' },
    ]);
  });

  it('a page body, a traversal and a GBrain anchor are not an absence', () => {
    const degraded = new Set(withoutCarrier(binding).map(({ slot }) => slot));

    expect(degraded.has('identity.meaning')).toBe(false);
    expect(degraded.has('area_of_focus.standard')).toBe(false);
    expect(degraded.has('objective.supporting_projects')).toBe(false);
  });
});
