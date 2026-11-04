import { ALPHA_ID, pageRead } from '../../test/fixtures/gbrain-pages.fixture';
import { lostFacts, lostTimelineEntries } from './anchor-drift';
import type { FactRead, PageRead, TimelineEntry } from './gbrain-pages';

const kickoff: TimelineEntry = {
  date: '2026-10-13',
  summary: 'Kickoff held',
  source: 'notion:thread 1',
  detail: '',
};

const budget: FactRead = {
  fact: 'Gamma budget cap is 10k EUR',
  kind: 'fact',
  entitySlug: 'projects/gamma',
  provenance: 'user said in chat 2026-10-13',
};

const intact: PageRead = pageRead({
  slug: 'projects/gamma',
  compiledTruth: `# Gamma\n\nNotion: ${ALPHA_ID}\n\n## Facts\n\n| 1 | Gamma budget cap is 10k EUR | fact |`,
  timeline: '## Timeline\n\n- **2026-10-13** | notion:thread 1 — Kickoff held',
});

describe('lostTimelineEntries', () => {
  it('a page with an item for every event has lost nothing', () => {
    expect(lostTimelineEntries(intact, [kickoff])).toEqual([]);
  });

  it('a page replaced without a timeline section has lost events the database still keeps', () => {
    expect(lostTimelineEntries({ ...intact, timeline: '' }, [kickoff])).toEqual([kickoff]);
  });

  it('an event whose summary line is split over two lines is found', () => {
    const wrapped: TimelineEntry = { ...kickoff, summary: 'Kickoff\n held' };

    expect(lostTimelineEntries(intact, [wrapped])).toEqual([]);
  });

  it('an item for another day does not cover the event', () => {
    expect(lostTimelineEntries(intact, [{ ...kickoff, date: '2026-10-14' }])).toHaveLength(1);
  });
});

describe('lostFacts', () => {
  it('a fact in the facts section of the page is not lost', () => {
    expect(lostFacts(intact, [budget])).toEqual([]);
  });

  it('a page replaced without a facts section has lost the facts about itself', () => {
    const replaced: PageRead = { ...intact, compiledTruth: `# Gamma\n\nNotion: ${ALPHA_ID}` };

    expect(lostFacts(replaced, [budget])).toEqual([budget]);
  });

  it('a fact about another page or about no page does not concern this one', () => {
    const replaced: PageRead = { ...intact, compiledTruth: '# Gamma' };

    expect(lostFacts(replaced, [{ ...budget, entitySlug: 'projects/other' }])).toEqual([]);
    expect(lostFacts(replaced, [{ ...budget, entitySlug: null }])).toEqual([]);
  });
});
