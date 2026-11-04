import { dependencyConsistency } from '../../src/methodology/dependency';
import { linkedPageIds } from '../../src/methodology/linked-pages';
import { isUndetermined } from '../../src/methodology/undetermined';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { HarnessError, InfrastructureError } from './gate-attempts';
import type { PageSnapshot } from './gate-claims';
import type { Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import type { ScenarioInfo } from './m6-scenarios';
import { Ids, pageOf, type ScenarioWorld } from './scenario-world';

/**
 * Checks that the pages the world describes with one state are read with that same state. A
 * mismatch is a fault of the scenario description or of the workspace binding, not behavior,
 * because a run over a world with a mismatch would prove nothing.
 */
export function readProblems(pages: World, read: Readonly<Record<string, PageSnapshot>>): string[] {
  return pages.flatMap((page) => {
    const snapshot = read[page.key];

    if (snapshot === undefined) return [`${page.key} is not read`];

    const problems: string[] = [];
    const wanted =
      page.type === 'project' || page.type === 'task'
        ? ['status', page.status, snapshot.status]
        : page.type === 'behavior_system'
          ? ['lifecycle', page.lifecycle, snapshot.lifecycle]
          : page.type === 'area_of_focus'
            ? ['mode', page.mode, snapshot.mode]
            : null;

    if (wanted !== null && wanted[1] !== wanted[2]) {
      problems.push(
        `${page.key}: ${wanted[0]} reads ${String(wanted[2])}, designed ${String(wanted[1])}`,
      );
    }

    if (page.type === 'task') {
      if ((page.dateInDays !== undefined) !== (snapshot.date !== null)) {
        problems.push(`${page.key}: Date does not read as designed`);
      }

      if ((page.deadlineInDays !== undefined) !== (snapshot.deadline !== null)) {
        problems.push(`${page.key}: Deadline does not read as designed`);
      }
    }

    return problems;
  });
}

/**
 * Checks whether every project or Behavior System of the world already lists, on its side, the
 * Tasks that point to it. An empty list or a missing id means Notion is still synchronizing the
 * reverse side of the relation. A relation that does not read as a list (no carrier in the binding,
 * a value outside the canon, a truncated list) is not fixed by waiting. That is a fault of the
 * binding or of the world description.
 */
async function backLinkProblems(
  world: ScenarioWorld,
  pages: World,
  ids: Ids,
): Promise<{ readonly designed: string[]; readonly unsynced: string[] }> {
  const records = world.recordReader();
  const designed: string[] = [];
  const unsynced: string[] = [];

  for (const owner of pages) {
    if (owner.type !== 'project' && owner.type !== 'behavior_system') continue;

    const expected = pages
      .filter(
        (page) =>
          page.type === 'task' &&
          (owner.type === 'project' ? page.project : page.behaviorSystem) === owner.key,
      )
      .map((page) => canonicalNotionId(pageOf(ids, page.key)));
    const record = await records.read(owner.type, pageOf(ids, owner.key));
    const listed = linkedPageIds(record.readings.tasks);

    if (isUndetermined(listed)) {
      designed.push(`${owner.key} does not read its Tasks as a list (${listed.because})`);

      continue;
    }

    const have = listed.map(canonicalNotionId);
    const absent = expected.filter((id) => !have.includes(id));

    if (absent.length > 0) {
      unsynced.push(`${owner.key} does not list ${absent.length} of its Tasks`);
    }
  }

  return { designed, unsynced };
}

/** Checks that the methodology rule on a blocked `Next Action` says what scenario K1 intends. */
async function blockedNextActionProblems(world: ScenarioWorld, ids: Ids): Promise<string[]> {
  const records = world.recordReader();
  const dependent = await records.read('task', pageOf(ids, 'dependent'));
  const blocker = await records.read('task', pageOf(ids, 'blocker'));
  const consistency = dependencyConsistency(dependent, new Map([[blocker.pageId, blocker]]));

  return consistency.state === 'contradiction' &&
    consistency.kind === 'next_action_with_unresolved_blocker'
    ? []
    : ['the dependent Task does not read as a Next Action with an unresolved blocker'];
}

/**
 * What is wrong with the world that was just built. `designed`: the world does not read as designed
 * (a harness fault, a retry does not fix it); `unsynced`: Notion has not yet returned the reverse
 * side of a relation (infrastructure; a retry on a new world may help).
 */
interface WorldProblems {
  readonly designed: readonly string[];
  readonly unsynced: readonly string[];
}

/** Checks that the scenario's world reads as designed, without the model and without quota. */
async function worldProblems(
  world: ScenarioWorld,
  info: ScenarioInfo,
  pages: World,
  ids: Ids,
): Promise<WorldProblems> {
  const links = await backLinkProblems(world, pages, ids);
  const designed = [
    ...readProblems(pages, await world.snapshots(ids, false)),
    ...links.designed,
    ...(info.id === 'K1_blocked_next_action' ? await blockedNextActionProblems(world, ids) : []),
  ];

  return { designed, unsynced: links.unsynced };
}

/**
 * Builds the scenario's world and makes sure it reads as designed, because a run over a world that
 * reads differently would prove nothing. A harness fault is a `HarnessError`, and a retry does not
 * fix it. The reverse side of a relation that Notion has not returned yet is an
 * `InfrastructureError`, and a retry on a new world may help.
 */
export async function buildVerified(
  world: ScenarioWorld,
  info: ScenarioInfo,
  pages: World,
  residue: Residue,
): Promise<Ids> {
  const ids = await world.build(pages, residue);
  const { designed, unsynced } = await worldProblems(world, info, pages, ids);

  if (designed.length > 0) {
    throw new HarnessError(
      `the world of ${info.id} does not read as designed: ${designed.join('; ')}`,
    );
  }

  if (unsynced.length > 0) {
    throw new InfrastructureError(
      `Notion has not listed the links of the world of ${info.id} in time: ${unsynced.join('; ')}`,
    );
  }

  return ids;
}
