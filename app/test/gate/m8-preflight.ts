import { Client } from '@notionhq/client';
import { CommentsReader } from '../../src/notion/client/comments.reader';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { allComments } from './m4-world';
import { checked, type Check } from './m6-preflight';
import { tagOf, type ScenarioId, type ScenarioInfo } from './m6-scenarios';
import { FINDER_EXPECTED, finderWorld } from './m8-scenarios';
import type { M8World } from './m8-world';
import { task } from './scenario-kit';
import { pageOf } from './scenario-world';

/**
 * Checks of gate M8 that need neither the model nor the query allowance, run before the first run.
 * Each blocks only the scenarios that would prove nothing without it: a review without stale
 * items, a sweep over a query Notion does not execute, a reconciliation over a comment that cannot
 * be deleted.
 */

/** Returns the selected scenarios among the named ones. */
const among = (selected: readonly ScenarioInfo[], ids: readonly ScenarioId[]): ScenarioId[] =>
  selected.filter((info) => ids.includes(info.id)).map((info) => info.id);

/** Returns the tag of a check world, which does not repeat between checks or between gate runs. */
const tagFor = (run: string, check: ScenarioId): string =>
  tagOf({ run: `pre${run}`, scenario: check, trial: 1, attempt: 0 });

/** Checks that the seeded items are in the declared state and stale. */
async function fixturesCheck(world: M8World, selected: readonly ScenarioInfo[]): Promise<Check> {
  const problems = await world.fixtureProblems();

  return {
    check: 'the planted Inbox items are stale and as declared',
    ok: problems.length === 0,
    detail: problems,
    blocks: among(selected, ['D1_daily_control', 'W1_weekly_review']),
  };
}

/**
 * Checks that the environment contains only what was seeded, because reviews, the sweep and the
 * reconciliation see everything that is there.
 */
async function environmentCheck(world: M8World, selected: readonly ScenarioInfo[]): Promise<Check> {
  const foreign = await world.foreign();

  return {
    check: 'the gate workspace and app_db_gate hold nothing but the planted items',
    ok: foreign.length === 0,
    detail: foreign,
    blocks: selected.map((info) => info.id),
  };
}

/**
 * Checks that a comment on a live page gets deleted. That is how cleanup returns the seeded items
 * to the declared state.
 */
function deletionCheck(
  world: M8World,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check> {
  const blocks = among(selected, [
    'C1_resolution_reconciled',
    'D1_daily_control',
    'W1_weekly_review',
  ]);

  return checked(
    world,
    'a comment deleted on a live page is gone for the App',
    blocks,
    async (residue) => {
      const tag = tagFor(run, 'C1_resolution_reconciled');
      const ids = await world.build(
        [
          {
            key: 'project',
            type: 'project',
            name: `Перевірка коментарів «Орбіта-${tag}»`,
            status: 'Active',
          },
          task({
            key: 'task',
            name: `Задача перевірки «Орбіта-${tag}»`,
            status: 'Next Action',
            project: 'project',
          }),
        ],
        residue,
      );
      const thread = await world.systemThread(
        ids,
        'task',
        'Gate: коментар, який видалять',
        residue,
      );

      await world.deleteComment(thread.commentId);

      const left = await allComments(world.service(Client), pageOf(ids, 'task'));
      const listed = left.some((comment) => canonicalNotionId(comment.id) === thread.commentId);
      // Notion returns a deleted comment by id as well, so the App must see it as deleted.
      const kept = await world.service(CommentsReader).exists(thread.commentId);

      return { ok: !listed && !kept, detail: { listed, kept } };
    },
  );
}

/**
 * Checks where the person's reply in a review thread is routed: processing on an Inbox item,
 * evaluation on a Task.
 */
function routeCheck(
  world: M8World,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check> {
  return checked(
    world,
    'a reply in a thread of the weekly review goes to dialogue on an Inbox item and to event evaluation on a Task',
    among(selected, ['W1_weekly_review']),
    async (residue) => {
      const tag = tagFor(run, 'W1_weekly_review');
      const ids = await world.build(
        [
          {
            key: 'project',
            type: 'project',
            name: `Перевірка відповіді «Орбіта-${tag}»`,
            status: 'Active',
          },
          task({
            key: 'task',
            name: `Задача відповіді «Орбіта-${tag}»`,
            status: 'Next Action',
            project: 'project',
          }),
          { key: 'item', type: 'inbox_item', name: `Запис відповіді «Орбіта-${tag}»` },
        ],
        residue,
      );
      const routes = {
        task: await world.replyRoute(pageOf(ids, 'task'), 'weekly_control_review', residue),
        item: await world.replyRoute(pageOf(ids, 'item'), 'weekly_control_review', residue),
      };

      return {
        ok: routes.task === 'event_evaluation' && routes.item === 'dialogue',
        detail: routes,
      };
    },
  );
}

/**
 * Checks the real sweep finder over a world with one positive per rule. The finder swallows the
 * failure of a group of queries, and only a positive for each rule makes such a failure visible.
 */
function finderCheck(
  world: M8World,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check> {
  return checked(
    world,
    'the sweep finder reads every rule from the real workspace',
    among(selected, ['SW1_safety_sweep']),
    async (residue) => {
      const ids = await world.build(finderWorld(tagFor(run, 'SW1_safety_sweep')), residue);
      const keyOf = new Map(Object.entries(ids).map(([key, id]) => [canonicalNotionId(id), key]));
      const found = (await world.finderCandidates())
        .map((candidate) => ({
          page: keyOf.get(candidate.pageId) ?? candidate.pageId,
          rule: candidate.rule,
        }))
        .sort((a, b) => `${a.page}/${a.rule}`.localeCompare(`${b.page}/${b.rule}`));
      const expected = [...FINDER_EXPECTED].sort((a, b) =>
        `${a.page}/${a.rule}`.localeCompare(`${b.page}/${b.rule}`),
      );

      return {
        ok: JSON.stringify(found) === JSON.stringify(expected),
        detail: { expected, found },
      };
    },
  );
}

/**
 * Checks that the ingress takes a body edit of a Task and turns away one of an Area of Focus. The
 * gate writes an edit on behalf of the person with a personal token.
 */
function intakeCheck(
  world: M8World,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check> {
  return checked(
    world,
    'the intake takes a body edit of a Task and turns away one of an Area of Focus',
    among(selected, ['X1_body_commitment']),
    async (residue) => {
      const tag = tagFor(run, 'X1_body_commitment');
      const ids = await world.build(
        [
          {
            key: 'project',
            type: 'project',
            name: `Перевірка входу «Орбіта-${tag}»`,
            status: 'Active',
          },
          task({
            key: 'task',
            name: `Задача входу «Орбіта-${tag}»`,
            status: 'Next Action',
            project: 'project',
          }),
          {
            key: 'area',
            type: 'area_of_focus',
            name: `Сфера входу «Орбіта-${tag}»`,
            mode: 'Maintain',
          },
        ],
        residue,
      );

      await world.writeNote(ids, 'task', ['Gate: правка тіла від імені людини']);

      const taskEdit = await world.notionEvent(ids, { type: 'page.content_updated', page: 'task' });
      const areaEdit = await world.notionEvent(ids, { type: 'page.content_updated', page: 'area' });

      return {
        ok: taskEdit.windowed && !areaEdit.windowed && areaEdit.reason !== null,
        detail: { task: taskEdit, area: areaEdit },
      };
    },
  );
}

/** A check and the scenarios that need it: it is not run unless one of them is selected. */
const CHECKS: readonly {
  readonly needed: readonly ScenarioId[] | 'all';
  readonly run: (world: M8World, selected: readonly ScenarioInfo[], run: string) => Promise<Check>;
}[] = [
  { needed: 'all', run: environmentCheck },
  { needed: ['D1_daily_control', 'W1_weekly_review'], run: fixturesCheck },
  {
    needed: ['C1_resolution_reconciled', 'D1_daily_control', 'W1_weekly_review'],
    run: deletionCheck,
  },
  { needed: ['W1_weekly_review'], run: routeCheck },
  { needed: ['SW1_safety_sweep'], run: finderCheck },
  { needed: ['X1_body_commitment'], run: intakeCheck },
];

/** How many model-free checks the M8 suite has: their table in `infra/GATE.md` has as many rows. */
export const M8_CHECK_COUNT = CHECKS.length;

/**
 * Runs the checks of the M8 suite in order: the environment first, while no check has built
 * anything, and only those that at least one selected scenario needs.
 */
export async function m8Checks(
  world: M8World,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check[]> {
  const checks: Check[] = [];

  for (const check of CHECKS) {
    if (check.needed !== 'all' && among(selected, check.needed).length === 0) continue;

    checks.push(await check.run(world, selected, run));
  }

  return checks;
}
