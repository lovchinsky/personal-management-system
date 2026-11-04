import { worldThat } from '../fixtures/m6-probe-world.fixture';
import { preflight } from './m6-preflight';
import {
  remembers,
  repliesInChannel,
  scenariosOf,
  shortOf,
  slotsOf,
  type ScenarioId,
  type ScenarioInfo,
} from './m6-scenarios';

/** The M6 suite: the catalog is shared with M7 and the M6 checks ask only about their scenarios. */
const M6_SCENARIOS = scenariosOf('m6');

function only(...short: string[]): ScenarioInfo[] {
  return M6_SCENARIOS.filter((info) => short.includes(shortOf(info.id)));
}

const names = (infos: readonly ScenarioInfo[]): ScenarioId[] => infos.map((info) => info.id);

describe('what a scenario needs', () => {
  it('event slots: a scenario has its own, a chain has the date slot, a reply from the person has none', () => {
    expect(slotsOf('N1_free_path')).toEqual(['task.deadline']);
    expect(slotsOf('W1_dependency_chain')).toEqual(['task.date']);
    expect(slotsOf('U1_commitment')).toEqual([]);
  });

  it('a reply in the channel is needed by the U family, memory only by F1 and F2', () => {
    expect(names(M6_SCENARIOS.filter((info) => repliesInChannel(info.id))).map(shortOf)).toEqual([
      'U1',
      'U2',
      'U4',
      'E1',
      'U3',
      'U5',
    ]);
    expect(names(M6_SCENARIOS.filter((info) => remembers(info.id))).map(shortOf)).toEqual([
      'F1',
      'F2',
    ]);
  });
});

describe('preflight', () => {
  it('everything passes: events, channel and memory, each with its own scenarios', async () => {
    const checks = await preflight(await worldThat(), M6_SCENARIOS, '4821', false);

    expect(checks.map((check) => [check.check, check.ok])).toEqual([
      ['every event of the scenarios names a property the binding carries', true],
      ['a reply in the channel opens a window of its own', true],
      ['a GBrain page is written, found by the project id and removed', true],
    ]);
  });

  it('a slot with no carrier blocks only the scenarios woken by it', async () => {
    const checks = await preflight(
      await worldThat({ missingSlots: ['task.deadline'] }),
      M6_SCENARIOS,
      '4821',
      false,
    );
    const triggers = checks[0];

    expect(triggers?.ok).toBe(false);
    expect(triggers?.detail).toMatchObject({ missing: ['task.deadline'] });
    expect(triggers?.blocks.map(shortOf)).toEqual(['N1', 'Q1', 'N2']);
  });

  it('when the channel does not answer, only the scenarios with a reply from the person are stopped', async () => {
    const [, channel] = await preflight(
      await worldThat({ channel: 'misses' }),
      M6_SCENARIOS,
      '4821',
      false,
    );

    expect(channel).toMatchObject({ ok: false });
    expect(channel?.blocks.map(shortOf)).toEqual(['U1', 'U2', 'U4', 'E1', 'U3', 'U5']);
  });

  it('a check failure is a result, not an exception; the cleanup still runs after the check', async () => {
    const world = await worldThat({ channel: 'throws', memory: 'throws' });
    const checks = await preflight(world, M6_SCENARIOS, '4821', false);

    expect(checks.slice(1).map((check) => [check.ok, check.detail])).toEqual([
      [false, 'the webhook answered 502'],
      [false, 'gbrain put_page: 502'],
    ]);
    expect(world.cleaned).toHaveLength(2);
  });

  it('when memory is not written, only F1 and F2 are stopped', async () => {
    const [, , memory] = await preflight(
      await worldThat({ memory: 'throws' }),
      M6_SCENARIOS,
      '4821',
      false,
    );

    expect(memory?.blocks.map(shortOf)).toEqual(['F1', 'F2']);
  });

  it('a selection without replies and memory has only the events check', async () => {
    const checks = await preflight(await worldThat(), only('N1', 'P1'), '4821', false);

    expect(checks.map((check) => check.check)).toEqual([
      'every event of the scenarios names a property the binding carries',
    ]);
  });

  it('slots that the selected scenarios do not have are not checked', async () => {
    const checks = await preflight(
      await worldThat({ missingSlots: ['task.deadline'] }),
      only('P1'),
      '4821',
      false,
    );

    expect(checks[0]).toMatchObject({ ok: true, blocks: [] });
  });

  it('each check keeps its own cleanup registry', async () => {
    const world = await worldThat();

    await preflight(world, M6_SCENARIOS, '4821', false);

    expect(world.cleaned).toHaveLength(2);
    expect(new Set(world.cleaned).size).toBe(world.cleaned.length);
  });
});

/**
 * A cleanup that could not remove something is a check failure, because the check “written, found
 * and removed” is then not satisfied.
 */
describe('preflight: what the cleanup left behind', () => {
  it('a memory page that could not be removed fails the check and blocks F1 and F2', async () => {
    const checks = await preflight(
      await worldThat({ left: ['gbrain projects/gate-m6-pre4821'] }),
      only('F1', 'F2'),
      '4821',
      false,
    );
    const memory = checks.find((check) => check.check.startsWith('a GBrain page'));

    expect(memory).toMatchObject({
      ok: false,
      detail: { left: ['gbrain projects/gate-m6-pre4821'] },
    });
    expect(memory?.blocks.map(shortOf)).toEqual(['F1', 'F2']);
  });

  it('a check failure is not masked by the cleanup residue: the cause is kept alongside it', async () => {
    const [, memory] = await preflight(
      await worldThat({ memory: 'throws', left: ['notion page x'] }),
      only('F1'),
      '4821',
      false,
    );

    expect(memory).toMatchObject({
      ok: false,
      detail: { result: 'gbrain put_page: 502', left: ['notion page x'] },
    });
  });
});

/**
 * Under `--preflight` the world of every selected scenario is built with its memory. Building the
 * world is the first thing a live launch checks.
 */
describe('preflight --preflight (deep check)', () => {
  const deep = (world: Awaited<ReturnType<typeof worldThat>>, ...short: string[]) =>
    preflight(world, short.length === 0 ? M6_SCENARIOS : only(...short), '4821', true);
  const worldChecks = (checks: Awaited<ReturnType<typeof deep>>) =>
    checks.filter((check) => check.check.startsWith('the world of'));

  it('every selected scenario has its own world check, and it blocks only that scenario', async () => {
    const checks = worldChecks(await deep(await worldThat()));

    expect(checks).toHaveLength(M6_SCENARIOS.length);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks.map((check) => check.blocks)).toEqual(M6_SCENARIOS.map((info) => [info.id]));
    expect(checks.map((check) => check.check)).toEqual(
      M6_SCENARIOS.map((info) => `the world of ${info.id} reads as designed`),
    );
  });

  it('worlds are not built without the deep check', async () => {
    const checks = await preflight(await worldThat(), M6_SCENARIOS, '4821', false);

    expect(worldChecks(checks)).toEqual([]);
  });

  it('a world that reads differently than designed fails its own check and no other', async () => {
    const checks = worldChecks(
      await deep(await worldThat({ reads: { target: 'Done' } }), 'N1', 'P1'),
    );
    const [n1, p1] = checks;

    expect(n1).toMatchObject({ ok: false, blocks: ['N1_free_path'] });
    expect(JSON.stringify(n1?.detail)).toContain('target: status reads Done, designed');
    expect(p1?.ok).toBe(true);
  });

  /**
   * A retry does not fix a harness fault, so the check reports it as design, not as an
   * infrastructure failure.
   */
  it('a world whose project does not return Tasks as a list is a binding fault, reported as design', async () => {
    const [check] = worldChecks(await deep(await worldThat({ links: 'unreadable' }), 'N1'));

    expect(check?.ok).toBe(false);
    expect(JSON.stringify(check?.detail)).toContain('does not read as designed');
    expect(JSON.stringify(check?.detail)).toContain('does not read its Tasks as a list');
  });

  it('the reverse side of a relation that Notion has not returned yet is an infrastructure failure, reported as such', async () => {
    const [check] = worldChecks(await deep(await worldThat({ links: 'short' }), 'N1'));

    expect(check?.ok).toBe(false);
    expect(JSON.stringify(check?.detail)).toContain('has not listed the links');
  });

  it('scenario memory that was not written fails the world check of that scenario', async () => {
    const checks = worldChecks(await deep(await worldThat({ memory: 'throws' }), 'F1', 'N1'));
    const [n1, f1] = checks;

    expect(f1).toMatchObject({ ok: false, detail: 'gbrain put_page: 502' });
    expect(n1?.ok).toBe(true);
  });

  it('K1: a resolved blocker is not a “Next Action with an unresolved blocker”', async () => {
    const [ok] = worldChecks(await deep(await worldThat(), 'K1'));
    const [resolved] = worldChecks(
      await deep(await worldThat({ reads: { blocker: 'Done' } }), 'K1'),
    );

    expect(ok?.ok).toBe(true);
    expect(resolved?.ok).toBe(false);
  });
});
