import { DECISION_MARKER, MEMORY_THRESHOLDS, MEMORY_WRITES } from './memory-writes';

describe('MEMORY_WRITES', () => {
  it('has one row for each kind', () => {
    const kinds: string[] = MEMORY_WRITES.map(({ kind }) => kind);

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(
      expect.arrayContaining(['timeline_event', 'fact', 'decision', 'anchor', 'lesson']),
    );
  });

  it('memory entries go through an App intent; pages and links are unavailable to a run', () => {
    const recorded: string[] = MEMORY_WRITES.filter(
      ({ capability }) => capability === 'memory_record',
    ).map(({ kind }) => kind);

    expect(recorded).toEqual(['timeline_event', 'fact', 'decision', 'standard', 'anchor']);

    expect(
      MEMORY_WRITES.filter(({ run }) => run === 'none').map(({ capability }) => capability),
    ).toEqual(['page_write', 'graph_write', 'page_write', 'page_write']);
  });

  it('an anchor appears only together with an entry, and generalizations have a threshold', () => {
    expect(MEMORY_WRITES.find(({ kind }) => kind === 'anchor')).toMatchObject({
      run: 'with_entry',
      chat: 'with_entry',
    });

    for (const write of MEMORY_WRITES.filter(({ kind }) => /lesson|observation/.test(kind))) {
      expect(write.threshold).toBeDefined();
    }
  });
});

describe('MEMORY_THRESHOLDS', () => {
  it('the cognitive observation threshold is higher than the lesson threshold and requires more', () => {
    expect(MEMORY_THRESHOLDS.cognitive_observation.minIndependentEpisodes).toBeGreaterThan(
      MEMORY_THRESHOLDS.lesson.minIndependentEpisodes,
    );
    expect(MEMORY_THRESHOLDS.cognitive_observation.requires.length).toBeGreaterThan(
      MEMORY_THRESHOLDS.lesson.requires.length,
    );
  });

  it('both require confirmation from the person', () => {
    expect(MEMORY_THRESHOLDS.lesson.requires).toContain('person_confirmation');
    expect(MEMORY_THRESHOLDS.cognitive_observation.requires).toContain('person_confirmation');
  });
});

describe('DECISION_MARKER', () => {
  it('ends with a colon: the wording of the decision starts after it', () => {
    expect(DECISION_MARKER).toMatch(/:$/);
  });
});
