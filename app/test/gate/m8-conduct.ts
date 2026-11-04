import type { ReviewMode } from '../../src/runs/trigger-envelope';
import { sameId } from './gate-claims';
import type { Residue } from './gate-cleanup';
import type { Conductor, Conductors } from './m6-conduct';
import { memoryOf, tagOf, variantNumber, worldOf, type ScenarioInfo } from './m6-scenarios';
import {
  bodyClaim,
  dailyClaim,
  deepClaim,
  lessonClaim,
  reconciliationClaim,
  strategicClaim,
  sweepClaim,
  weeklyClaim,
} from './m8-claims';
import type { Evidence8, M8Port, M8Script } from './m8-evidence';
import {
  C1_THREADS,
  D1_PROPOSAL_TASK,
  MODEL_MODE_OF,
  REVIEW_OF,
  S1_THREADS,
  X1_MOVED_DEADLINE_DAYS,
  X1_NOTE,
  type M8ScenarioId,
} from './m8-scenarios';
import { pageOf, type Ids } from './scenario-world';

/**
 * Conductors of the gate M8 scenarios, with the steps of each over the M8 port and the claims drawn
 * from them. Each starts by checking that the environment contains only what was seeded, because a
 * review, the sweep and the reconciliation see everything that is there.
 */

/**
 * Prepares the world of an attempt: it checks the environment, builds the world and seeds the
 * memory of the scenario.
 */
async function worldFor(
  port: M8Port,
  info: ScenarioInfo,
  tag: string,
  variant: number,
  residue: Residue,
): Promise<Ids> {
  await port.assertIsolated();

  const ids = await port.buildWorld(worldOf(info.id, tag), info, residue);

  await port.plant(memoryOf(info.id, tag, variant), ids, residue);

  return ids;
}

/** Returns the review of a scenario according to the catalog. */
function modeOf(info: ScenarioInfo): ReviewMode {
  const mode = REVIEW_OF[info.id];

  if (mode === undefined) throw new Error(`the scenario ${info.id} is not a review`);

  return mode;
}

/** Builds a script that conducts a review over the world. The claim judges one run. */
const reviewing =
  (judge: (evidence: Evidence8) => ReturnType<typeof weeklyClaim>): M8Script =>
  async (port, info, ids, residue, record) =>
    judge(record(await port.review(modeOf(info), ids, 'review', residue)));

function m8Scripts(manual: boolean): Readonly<Record<M8ScenarioId, M8Script>> {
  return {
    C1_resolution_reconciled: async (port, _info, ids, residue) => {
      const { resolved: one, open: two, deleted: three } = C1_THREADS;
      const threads = {
        resolved: await port.systemThread(ids, one.page, one.text, residue),
        open: await port.systemThread(ids, two.page, two.text, residue),
        deleted: await port.systemThread(ids, three.page, three.text, residue),
      };
      const named = Object.values(threads).map((thread) => thread.discussionId);
      const first = await port.reconcileTick(named, residue);
      const resolved =
        manual && (await port.personResolves(ids, one.page, threads.resolved.discussionId))
          ? true
          : null;

      await port.deleteComment(threads.deleted.commentId);

      const second = await port.reconcileTick(named, residue);
      const third = await port.reconcileTick(named, residue);

      return reconciliationClaim({ threads, first, resolved, second, third });
    },
    D1_daily_control: async (port, _info, ids, residue, record) => {
      const proposal = await port.plantProposal(ids, D1_PROPOSAL_TASK, residue);

      return dailyClaim(
        record(await port.review('daily_control', ids, 'review', residue)),
        proposal,
      );
    },
    W1_weekly_review: reviewing(weeklyClaim),
    S1_strategic_review: async (port, _info, ids, residue, record) => {
      for (const thread of S1_THREADS) {
        await port.personAnswers(ids, thread.page, thread.question, thread.answer, residue);
      }

      return strategicClaim(record(await port.review('strategic_review', ids, 'review', residue)));
    },
    SW1_safety_sweep: async (port, _info, ids, residue, record) => {
      const woken = pageOf(ids, 'woken');
      const first = await port.sweepTick(residue);
      const wake = first.find((item) => sameId(item.pageId, woken));
      const run =
        wake === undefined ? null : record(await port.wake(wake.checkId, ids, 'recheck', residue));
      const second = await port.sweepTick(residue);

      return sweepClaim({ woken, first, run, second });
    },
    X1_body_commitment: async (port, _info, ids, residue, record) => {
      await port.writeNote(ids, 'estimate', [X1_NOTE]);

      const content = await port.notionEvent(ids, {
        type: 'page.content_updated',
        page: 'estimate',
      });

      await port.personMovesDeadline(ids, 'estimate', X1_MOVED_DEADLINE_DAYS);

      const properties = await port.notionEvent(ids, {
        type: 'page.properties_updated',
        page: 'estimate',
        slots: ['task.deadline'],
      });
      const control = await port.notionEvent(ids, { type: 'page.content_updated', page: 'home' });
      const window = await port.claimWindow(properties.eventId);
      const run = record(await window.run(ids, 'evaluation', residue));

      return bodyClaim({ content, properties, control, window, run });
    },
    S2_strategic_lesson: reviewing(lessonClaim),
    DP1_deep_review: reviewing(deepClaim),
  };
}

/**
 * Returns the M8 conductors bound to the port. The harness conducts them like the rest of the
 * procedures.
 */
export function m8Conductors(port: M8Port, manual: boolean): Conductors {
  const scripts = m8Scripts(manual);

  return Object.fromEntries(
    Object.entries(scripts).map(([id, script]): [string, Conductor] => [
      id,
      async (info, attempt, residue, record) => {
        const mode = MODEL_MODE_OF[info.id];

        if (mode !== undefined) await port.awaitAllowance(mode);

        const tag = tagOf(attempt);
        const ids = await worldFor(port, info, tag, variantNumber(attempt), residue);

        return script(port, info, ids, residue, (evidence) => {
          record(evidence);

          return evidence;
        });
      },
    ]),
  );
}
