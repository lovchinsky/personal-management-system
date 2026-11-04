import type { GbrainCall } from '../../src/claude/runner/run-tap';
import type { FactRead, TimelineEntry } from '../../src/knowledge/gbrain-pages';
import { ALPHA_ID, pageRead } from '../fixtures/gbrain-pages.fixture';
import {
  addedFacts,
  addedTimeline,
  argument,
  callsTo,
  NO_MEMORY,
  unchanged,
  type MemoryEvidence,
  type MemoryState,
} from './memory-evidence';

const entry = (summary: string, source = 'notion:thread 1'): TimelineEntry => ({
  date: '2026-10-13',
  summary,
  source,
  detail: '',
});

const fact = (text: string): FactRead => ({
  fact: text,
  kind: 'fact',
  entitySlug: 'projects/a',
  provenance: 'user said',
});

const state = (overrides: Partial<MemoryState> = {}): MemoryState => ({
  page: pageRead({ slug: 'projects/a' }),
  timeline: [],
  facts: [],
  ...overrides,
});

const evidence = (before: MemoryState, after: MemoryState): MemoryEvidence => ({
  slugs: { anchor: 'projects/a' },
  before: { anchor: before },
  after: { anchor: after },
  calls: [],
});

describe('addedTimeline and addedFacts', () => {
  it('new means the page did not have it before the run', () => {
    const memory = evidence(
      state({ timeline: [entry('Kickoff')], facts: [fact('A')] }),
      state({
        timeline: [entry('Kickoff'), entry('Decision: escalate after two days')],
        facts: [fact('A'), fact('B')],
      }),
    );

    expect(addedTimeline(memory, 'anchor').map((item) => item.summary)).toEqual([
      'Decision: escalate after two days',
    ]);
    expect(addedFacts(memory, 'anchor').map((item) => item.fact)).toEqual(['B']);
  });

  it('the same entry from another source is new', () => {
    const memory = evidence(
      state({ timeline: [entry('Kickoff')] }),
      state({ timeline: [entry('Kickoff'), entry('Kickoff', 'notion:thread 2')] }),
    );

    expect(addedTimeline(memory, 'anchor')).toHaveLength(1);
  });

  it('a repeat of an existing entry counts as added, because identical rows are counted with multiplicity', () => {
    const memory = evidence(
      state({ timeline: [entry('Decision: A')], facts: [fact('A')] }),
      state({
        timeline: [entry('Decision: A'), entry('Decision: A')],
        facts: [fact('A'), fact('A')],
      }),
    );

    expect(addedTimeline(memory, 'anchor')).toHaveLength(1);
    expect(addedFacts(memory, 'anchor')).toHaveLength(1);
  });

  it('a key the scenario did not put has nothing new', () => {
    expect(addedTimeline(NO_MEMORY, 'anchor')).toEqual([]);
    expect(addedFacts(NO_MEMORY, 'anchor')).toEqual([]);
  });
});

describe('unchanged', () => {
  it('a page is unchanged when its content, events and facts are the same', () => {
    expect(unchanged(evidence(state(), state()), 'anchor')).toBe(true);
  });

  it.each<[string, Partial<MemoryState>]>([
    ['an event appears', { timeline: [entry('x')] }],
    ['a fact appears', { facts: [fact('x')] }],
    ['the page text changes', { page: pageRead({ slug: 'projects/a', compiledTruth: 'new' }) }],
    [
      'the frontmatter changes',
      { page: pageRead({ slug: 'projects/a', frontmatter: { notion_id: ALPHA_ID, extra: 1 } }) },
    ],
    ['the page disappears', { page: null }],
  ])('the page is changed when %s', (_name, after) => {
    expect(unchanged(evidence(state(), state(after)), 'anchor')).toBe(false);
  });

  it('an unknown key is not considered unchanged, because nothing was compared', () => {
    expect(unchanged(NO_MEMORY, 'anchor')).toBe(false);
  });
});

describe('callsTo and argument', () => {
  const search: GbrainCall = { tool: 'search', ok: true, input: { query: 'q' } };
  const remember: GbrainCall = {
    tool: 'remember',
    ok: false,
    input: { fact: 'f', entity: 'projects/a' },
  };
  const memory: MemoryEvidence = { ...NO_MEMORY, calls: [search, remember] };

  it('selects calls by name, successful or not', () => {
    expect(callsTo(memory, 'remember', 'add_timeline_entry')).toEqual([remember]);
  });

  it('an argument is text or an empty string', () => {
    expect(argument(remember, 'entity')).toBe('projects/a');
    expect(argument(remember, 'ttl')).toBe('');
  });
});
