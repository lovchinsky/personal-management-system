import { DECISION_MARKER } from '../../src/knowledge/memory-writes';
import {
  plantedMemoryOf,
  scenariosOf,
  shortOf,
  SINGLE_RUNS,
  type ScenarioId,
} from './m6-scenarios';
import { LESSON_STEM, M7_RUNS, SUBJECT_STEM, TRAP_STEM, type M7ScenarioId } from './m7-scenarios';
import type { PlantedMemory } from './scenario-kit';

const TAG = '4821-u1-1';

const M7 = scenariosOf('m7');

const isM7 = (id: ScenarioId): id is M7ScenarioId => id in M7_RUNS;
const M7_IDS: readonly M7ScenarioId[] = M7.map((info) => info.id).filter(isM7);

const pagesOf = (id: M7ScenarioId, variant = 1): readonly PlantedMemory[] =>
  plantedMemoryOf(id, TAG, variant);

const anchorsOf = (id: M7ScenarioId): PlantedMemory[] =>
  pagesOf(id).filter((page) => page.kind === 'anchor');

const text = (page: PlantedMemory | undefined): string => page?.paragraphs.join(' ') ?? '';

describe('gate M7 scenarios', () => {
  it('nine blocking and two recorded; held-out are H5 and H7', () => {
    expect(M7.filter((info) => info.tier === 'blocking')).toHaveLength(9);
    expect(M7.filter((info) => info.tier === 'recorded').map((info) => shortOf(info.id))).toEqual([
      'H10',
      'H11',
    ]);
    expect(M7.filter((info) => info.heldOut).map((info) => shortOf(info.id))).toEqual(['H5', 'H7']);
  });

  it('every scenario of the suite has a single-run description and composes memory for GBrain', () => {
    expect(M7_IDS).toHaveLength(M7.length);

    for (const id of M7_IDS) {
      expect(SINGLE_RUNS[id]).toBeDefined();
      expect(pagesOf(id).length).toBeGreaterThan(0);
    }
  });

  it('all memory pages have unique keys, and anchors point to the pages of the world they concern', () => {
    for (const id of M7_IDS) {
      const keys = pagesOf(id).map((page) => page.key);
      const world = SINGLE_RUNS[id]?.world(TAG).map((page) => page.key) ?? [];

      expect(new Set(keys).size).toBe(keys.length);

      const concerned = pagesOf(id).flatMap((page) =>
        page.kind === 'anchor' && page.of !== null ? [page.of] : [],
      );

      expect(concerned.filter((key) => !world.includes(key))).toEqual([]);
    }
  });

  it('an anchor title is the name of the world object it belongs to: the Skill recognizes the object by the name', () => {
    for (const id of M7_IDS) {
      const world = SINGLE_RUNS[id]?.world(TAG) ?? [];

      for (const page of anchorsOf(id)) {
        if (page.kind !== 'anchor' || page.of === null) continue;

        expect(world.find((item) => item.key === page.of)?.name).toBe(page.title);
      }
    }
  });

  it("the person's words in every variant mention the subject with the attempt tag, and the variants differ", () => {
    const subject = `${SUBJECT_STEM}-${TAG}`;

    for (const id of M7_IDS) {
      const trigger = SINGLE_RUNS[id]?.trigger;

      if (trigger?.kind !== 'reply') continue;

      const said = [1, 2, 3, 4].map((variant) => trigger.words(TAG, variant));

      expect(said.every((words) => words.includes(subject))).toBe(true);
      expect(new Set(said.slice(0, 3)).size).toBe(3);
      expect(said[3]).toBe(said[0]);
    }
  });

  it('H1 and H2 are routine: the project moves, the anchor is neutral, there is no Decision in memory', () => {
    for (const id of ['H1_routine_done', 'H2_routine_answer'] as const) {
      const [anchor] = pagesOf(id);

      expect(anchor?.kind === 'anchor' && anchor.of).toBe('project');
      expect(text(anchor)).not.toContain(DECISION_MARKER);
    }

    const world = SINGLE_RUNS.H1_routine_done?.world(TAG) ?? [];

    expect(
      world.filter((page) => page.type === 'task' && page.status === 'Next Action'),
    ).toHaveLength(1);
  });

  it('H3: two anchors of one project with different slugs, the lesson only on the first, and a note that mentions the project', () => {
    const [first, copy, mention] = pagesOf('H3_two_anchors');

    expect(first?.kind === 'anchor' && first.of).toBe('project');
    expect(copy?.kind === 'anchor' && copy.of).toBe('project');
    expect(copy?.kind === 'anchor' && copy.slug).toBeDefined();
    expect(first?.kind === 'anchor' && first.slug).toBeUndefined();
    expect(first?.title).toBe(copy?.title);
    expect(text(first)).toContain(`${LESSON_STEM}-${TAG}`);
    expect(text(copy)).not.toContain(LESSON_STEM);
    expect(mention).toMatchObject({ kind: 'page', mentions: 'project' });
  });

  it("H4 and H7: the person's decision; H4 has a project anchor without the decision, H7 has only the anchor of another project", () => {
    const [anchor] = pagesOf('H4_decision_stated');
    const [other, ...rest] = pagesOf('H7_no_anchor');

    expect(anchor?.kind === 'anchor' && anchor.of).toBe('project');
    expect(JSON.stringify(anchor)).not.toContain(DECISION_MARKER);
    expect(other?.kind === 'anchor' && other.of).toBeNull();
    expect(rest).toEqual([]);
    expect(
      SINGLE_RUNS.H7_no_anchor?.world(TAG)
        .map((page) => page.name)
        .join(' '),
    ).not.toContain(other?.title ?? '?');
  });

  it("H5: the decision is already written on the anchor: an event with the marker, the person's subject and today's date", () => {
    const [anchor] = pagesOf('H5_decision_stored');
    const decisions =
      anchor?.kind === 'anchor'
        ? (anchor.timeline ?? []).filter((item) => item.summary.startsWith(DECISION_MARKER))
        : [];

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.summary).toContain(`${SUBJECT_STEM}-${TAG}`);
    expect(decisions[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(decisions[0]?.source.length).toBeGreaterThan(0);
  });

  it("H6: the anchor already has another fact, and the person's words mention the client", () => {
    const [anchor] = pagesOf('H6_fact_stated');

    expect(anchor?.kind === 'anchor' && anchor.facts).toHaveLength(1);
  });

  it('H8: the history of the Behavior System has one similar event, below any threshold', () => {
    const [anchor] = pagesOf('H8_below_threshold');

    expect(anchor).toMatchObject({ kind: 'anchor', of: 'system', type: 'behavior_system' });
    expect(anchor?.kind === 'anchor' && anchor.timeline).toHaveLength(1);
  });

  it('H9: the lesson is a page that links to the anchor, and the lesson of a similar project sits on another anchor and is reachable by topic', () => {
    const [anchor, lesson, similar] = pagesOf('H9_structure_first');

    expect(text(anchor)).not.toContain(LESSON_STEM);
    expect(lesson).toMatchObject({
      kind: 'page',
      linksTo: { key: 'anchor', type: 'derived_from' },
    });
    expect(text(lesson)).toContain(`${LESSON_STEM}-${TAG}`);
    expect(similar?.kind === 'anchor' && similar.of).toBeNull();
    expect(text(similar)).toContain(`${TRAP_STEM}-${TAG}`);
    expect(similar?.discoverableBy).toMatch(/юристи/);
  });

  it('every variant of the lesson names the mockups and does not advise escalation', () => {
    for (const variant of [1, 2, 3]) {
      const [, lesson] = pagesOf('H9_structure_first', variant);

      expect(text(lesson)).toMatch(/макет/);
      expect(text(lesson)).not.toMatch(/ескалац/i);
    }
  });

  it('H10: the anchor of an Area of Focus in `Advance` mode with an open Task', () => {
    const [anchor] = pagesOf('H10_standard_stated');
    const world = SINGLE_RUNS.H10_standard_stated?.world(TAG) ?? [];

    expect(anchor).toMatchObject({ kind: 'anchor', of: 'area_of_focus', type: 'area_of_focus' });
    expect(world.find((page) => page.key === 'area_of_focus')).toMatchObject({ mode: 'Advance' });
  });
});
