import { messageOf } from '../../src/platform/error/message-of';
import type { Residue } from './gate-cleanup';
import {
  memoryOf,
  remembers,
  repliesInChannel,
  slotsOf,
  tagOf,
  worldOf,
  type ScenarioId,
  type ScenarioInfo,
} from './m6-scenarios';
import type { M6World } from './m6-world';
import { buildVerified } from './m6-world-check';
import { pageOf } from './scenario-world';

/**
 * The result of one check before the first quota. `blocks` lists the scenarios that must not be
 * conducted when the check fails: a GBrain failure stops only those that use memory, not the whole
 * launch.
 */
export interface Check {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: unknown;
  readonly blocks: readonly ScenarioId[];
}

/** Selects the scenarios whose conduct needs what the check verifies: the check blocks these. */
const idsOf = (
  selected: readonly ScenarioInfo[],
  uses: (id: ScenarioId) => boolean,
): ScenarioId[] => selected.filter((info) => uses(info.id)).map((info) => info.id);

/** Checks that every event of the scenarios names a property that the binding carries. */
function triggersCheck(world: M6World, selected: readonly ScenarioInfo[]): Check {
  const slots = [...new Set(selected.flatMap((info) => slotsOf(info.id)))].sort();
  const missing = slots.filter((slot) => {
    try {
      world.propertyOf(slot);

      return false;
    } catch {
      return true;
    }
  });

  return {
    check: 'every event of the scenarios names a property the binding carries',
    ok: missing.length === 0,
    detail: { slots, missing },
    blocks: idsOf(selected, (id) => slotsOf(id).some((slot) => missing.includes(slot))),
  };
}

/**
 * Runs a check that cleans up after itself in every case and does not throw: a failure is the
 * result of the check. What the cleanup left behind is a failure too, because the check “written,
 * found and removed” would not pass when removal failed, and the scenarios that depend on the check
 * would leave pages the gate does not clean up.
 */
export async function checked(
  world: Pick<M6World, 'begin' | 'clean'>,
  check: string,
  blocks: readonly ScenarioId[],
  run: (residue: Residue) => Promise<{ readonly ok: boolean; readonly detail: unknown }>,
): Promise<Check> {
  const residue = world.begin();
  let result: { readonly ok: boolean; readonly detail: unknown };

  try {
    result = await run(residue);
  } catch (error) {
    result = { ok: false, detail: messageOf(error) };
  }

  const left = await world.clean(residue);

  return left.length === 0
    ? { check, blocks, ...result }
    : { check, blocks, ok: false, detail: { result: result.detail, left } };
}

/**
 * Checks that a memory page is written by the same path as in a scenario, with a real project page,
 * found by a search for the project id and removed.
 */
function memoryCheck(
  world: M6World,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check> {
  return checked(
    world,
    'a GBrain page is written, found by the project id and removed',
    idsOf(selected, remembers),
    async (residue) => {
      const ids = await world.build(
        [{ key: 'project', type: 'project', name: `Перевірка пам'яті ${run}`, status: 'Active' }],
        residue,
      );

      await world.plantMemory(
        [
          {
            kind: 'anchor',
            key: 'anchor',
            of: 'project',
            type: 'project',
            title: `Перевірка пам'яті ${run}`,
            paragraphs: ['Сторінку створює перевірка gate.'],
          },
        ],
        ids,
        residue,
      );

      return { ok: true, detail: null };
    },
  );
}

/** Checks that the person's reply in the channel reaches the gate's own window. */
function channelCheck(
  world: M6World,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check> {
  return checked(
    world,
    'a reply in the channel opens a window of its own',
    idsOf(selected, repliesInChannel),
    async (residue) => {
      const ids = await world.build(
        [
          {
            key: 'page',
            type: 'task',
            name: `Перевірка каналу ${run}`,
            status: 'Next Action',
          },
        ],
        residue,
      );
      const { ok, ...detail } = await world.channelReaches(pageOf(ids, 'page'), residue);

      return { ok, detail };
    },
  );
}

/**
 * Checks that the scenario's world reads as designed and that the scenario's memory is written and
 * found. This is exactly what every attempt does before the model run, but without the model and
 * without quota.
 */
function worldCheck(world: M6World, info: ScenarioInfo, run: string): Promise<Check> {
  return checked(world, `the world of ${info.id} reads as designed`, [info.id], async (residue) => {
    const tag = tagOf({ run: `pre${run}`, scenario: info.id, trial: 1, attempt: 0 });
    const pages = worldOf(info.id, tag);
    const ids = await buildVerified(world, info, pages, residue);

    await world.plantMemory(memoryOf(info.id, tag), ids, residue);

    return { ok: true, detail: null };
  });
}

/**
 * Runs the model-free checks, before any quota. It always checks whether every event has a carrier
 * in the binding, whether the person's reply in the channel reaches the window and whether GBrain
 * accepts a page. A deep check (`--preflight`) also checks the world of every selected scenario
 * with its memory. In an ordinary launch the world of an attempt is checked before its run, so
 * building it here as well would double the cost.
 */
export async function preflight(
  world: M6World,
  selected: readonly ScenarioInfo[],
  run: string,
  deep: boolean,
): Promise<Check[]> {
  const checks: Check[] = [triggersCheck(world, selected)];

  if (selected.some((info) => repliesInChannel(info.id))) {
    checks.push(await channelCheck(world, selected, run));
  }

  if (selected.some((info) => remembers(info.id))) {
    checks.push(await memoryCheck(world, selected, run));
  }

  if (deep) {
    for (const info of selected) {
      checks.push(await worldCheck(world, info, run));
    }
  }

  return checks;
}
