import { worldThat, type Behaviour } from '../fixtures/m6-probe-world.fixture';
import { HarnessError, InfrastructureError } from './gate-attempts';
import type { PageSnapshot } from './gate-claims';
import type { World } from './m5-scenarios';
import { SCENARIOS, SINGLE_RUNS, tagOf, type ScenarioId } from './m6-scenarios';
import { buildVerified, readProblems } from './m6-world-check';

const snapshot = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  id: 'id',
  name: 'Сторінка',
  status: null,
  mode: null,
  lifecycle: null,
  date: null,
  deadline: null,
  inTrash: false,
  comments: [],
  ...overrides,
});

const WORLD: World = [
  { key: 'project', type: 'project', name: 'Проєкт', status: 'Active' },
  {
    key: 'task',
    type: 'task',
    name: 'Задача',
    status: 'Scheduled',
    project: 'project',
    dateInDays: 3,
    deadlineInDays: 9,
  },
  { key: 'area_of_focus', type: 'area_of_focus', name: 'Сфера', mode: 'Advance' },
  { key: 'system', type: 'behavior_system', name: 'Поведінка', lifecycle: 'Installing' },
];

const READ: Record<string, PageSnapshot> = {
  project: snapshot({ status: 'Active' }),
  task: snapshot({ status: 'Scheduled', date: '2026-10-11', deadline: '2026-10-17' }),
  area_of_focus: snapshot({ mode: 'Advance' }),
  system: snapshot({ lifecycle: 'Installing' }),
};

describe('readProblems', () => {
  it('a world that reads as described has no problems', () => {
    expect(readProblems(WORLD, READ)).toEqual([]);
  });

  it('a status, lifecycle and mode that read differently are reported with the page and both values', () => {
    const problems = readProblems(WORLD, {
      ...READ,
      project: snapshot({ status: 'Paused' }),
      area_of_focus: snapshot({ mode: 'Maintain' }),
      system: snapshot({ lifecycle: 'Designed' }),
    });

    expect(problems).toEqual([
      'project: status reads Paused, designed Active',
      'area_of_focus: mode reads Maintain, designed Advance',
      'system: lifecycle reads Designed, designed Installing',
    ]);
  });

  it('a Date and Deadline that are missing, or that appear without being designed, are problems', () => {
    const problems = readProblems(WORLD, {
      ...READ,
      task: snapshot({ status: 'Scheduled', date: null, deadline: null }),
    });

    expect(problems).toEqual([
      'task: Date does not read as designed',
      'task: Deadline does not read as designed',
    ]);
    expect(
      readProblems([{ key: 'task', type: 'task', name: 'Задача', status: 'Next Action' }], {
        task: snapshot({ status: 'Next Action', date: '2026-10-11' }),
      }),
    ).toEqual(['task: Date does not read as designed']);
  });

  it('a page that was not read is a problem', () => {
    expect(readProblems(WORLD, { project: READ['project'] ?? snapshot() })).toContain(
      'task is not read',
    );
  });
});

/**
 * A world that reads differently than designed would prove nothing. A harness fault is a
 * `HarnessError` (a retry does not fix it); the reverse side of a relation that Notion has not
 * returned yet is an `InfrastructureError` (a retry on a new world may help). The class decides
 * whether a retry spends another run of quota.
 */
describe('buildVerified', () => {
  const build = async (
    id: ScenarioId,
    behaviour: Behaviour = {},
  ): Promise<Record<string, string>> => {
    const info = SCENARIOS.find((candidate) => candidate.id === id);
    const spec = SINGLE_RUNS[id];

    if (info === undefined || spec === undefined) throw new Error(`no single run for ${id}`);

    const world = await worldThat(behaviour);
    const tag = tagOf({ run: '4821', scenario: id, trial: 1, attempt: 0 });

    return buildVerified(world, info, spec.world(tag), world.begin());
  };

  it('a world that reads as designed returns the ids of its pages', async () => {
    expect(await build('N1_free_path')).toMatchObject({ target: 'target-id', free: 'free-id' });
  });

  it('a status that reads differently is a HarnessError naming the scenario and both values', async () => {
    const failure = build('N1_free_path', { reads: { target: 'Done' } });

    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(
      /the world of N1_free_path does not read as designed: target: status reads Done, designed/,
    );
  });

  it('a project that does not return Tasks as a list is a HarnessError: a binding fault, waiting will not help', async () => {
    const failure = build('N1_free_path', { links: 'unreadable' });

    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(/does not read its Tasks as a list \(truncated\)/);
  });

  it('a project that has not listed all its Tasks is an InfrastructureError: Notion is still synchronizing', async () => {
    const failure = build('N1_free_path', { links: 'short' });

    await expect(failure).rejects.toBeInstanceOf(InfrastructureError);
    await expect(failure).rejects.toThrow(
      /Notion has not listed the links of the world of N1_free_path/,
    );
    await expect(failure).rejects.toThrow(/project does not list 1 of its Tasks/);
  });

  it('a harness fault outweighs synchronization: when both are present, a retry will not help', async () => {
    const failure = build('N1_free_path', { reads: { target: 'Done' }, links: 'short' });

    await expect(failure).rejects.toBeInstanceOf(HarnessError);
  });

  /**
   * A blocked dependent that became `Waiting For` with a resolved blocker is also a contradiction
   * of the methodology, but another one: K1 is about a `Next Action` with an unresolved blocker.
   */
  it('K1: another contradiction of the methodology is also the wrong world, not a match', async () => {
    const failure = build('K1_blocked_next_action', {
      reads: { dependent: 'Waiting For', blocker: 'Done' },
    });

    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(
      /the dependent Task does not read as a Next Action with an unresolved blocker/,
    );
  });

  /**
   * World snapshots do not ask for comments, because that is an extra request per page, and the
   * evidence about the words comes from the effects.
   */
  it('the world is checked without comments', async () => {
    const info = SCENARIOS.find((candidate) => candidate.id === 'N1_free_path');
    const spec = SINGLE_RUNS['N1_free_path'];

    if (info === undefined || spec === undefined) throw new Error('N1 is a single run');

    const world = await worldThat();

    await buildVerified(world, info, spec.world('4821-aa'), world.begin());

    expect(world.snapshotRequests).toEqual([false]);
  });

  it('K1: a blocked `Next Action` is read using the methodology rule, otherwise it is a HarnessError', async () => {
    expect(await build('K1_blocked_next_action')).toMatchObject({ dependent: 'dependent-id' });

    const failure = build('K1_blocked_next_action', { reads: { blocker: 'Done' } });

    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(
      /the dependent Task does not read as a Next Action with an unresolved blocker/,
    );
  });
});
