import { reasonsOf } from '../../src/continuations/reason-class';
import { expectMode } from './gate-attempts';
import type { Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import type { ScenarioPort } from './m6-conduct';
import { wakeOf, type Evidence6 } from './m6-evidence';
import {
  CHAIN_MOVED_DEADLINE_DAYS,
  tagOf,
  variantNumber,
  type AttemptId,
  type ScenarioInfo,
} from './m6-scenarios';
import { M6World } from './m6-world';
import { buildVerified } from './m6-world-check';
import type { MemoryStates } from './memory-evidence';
import type { EditTrigger, MemoryPage, ReplyTrigger } from './scenario-kit';
import { pageOf, type Ids } from './scenario-world';

/**
 * Scenario port over the live world: Notion, `app_db`, the real dispatcher. Each step takes a
 * snapshot of the world state before the run, conducts the run the way the scheduler would, and
 * collects evidence from what the run wrote.
 */
export class LivePort implements ScenarioPort {
  constructor(private readonly world: M6World) {}

  begin(): Residue {
    return this.world.begin();
  }

  build(pages: World, info: ScenarioInfo, residue: Residue): Promise<Ids> {
    return buildVerified(this.world, info, pages, residue);
  }

  plant(pages: readonly MemoryPage[], ids: Ids, residue: Residue): Promise<void> {
    return this.world.plantMemory(pages, ids, residue);
  }

  awaitFindable(ids: Ids, key: string, query: string): Promise<void> {
    return this.world.awaitSearchable(pageOf(ids, key), query);
  }

  /**
   * Conducts an event on a page: the person changed properties, and the run's origin is the
   * operator.
   */
  async edit(ids: Ids, trigger: EditTrigger, step: string, residue: Residue): Promise<Evidence6> {
    const { world } = this;
    const [before, memoryBefore] = await Promise.all([
      world.snapshots(ids, false),
      world.memoryStates(residue),
    ]);
    const envelope = world.trigger(pageOf(ids, trigger.page), trigger.slots);
    const trace = await world.run(envelope, { origin: 'operator' }, residue);

    return world.evidenceFor(
      step,
      trace,
      ids,
      before,
      null,
      await this.memoryAround(memoryBefore.states, residue),
    );
  }

  /** Returns the state of the GBrain pages before the run (already taken) and after it. */
  private async memoryAround(
    before: MemoryStates['before'],
    residue: Residue,
  ): Promise<MemoryStates> {
    const after = await this.world.memoryStates(residue);

    return { slugs: after.slugs, before, after: after.states };
  }

  /**
   * Conducts the person's reply in the channel to a system message in its thread, through the same
   * steps as in normal operation.
   */
  async reply(
    ids: Ids,
    trigger: ReplyTrigger,
    id: AttemptId,
    residue: Residue,
  ): Promise<Evidence6> {
    const { world } = this;
    // In normal operation an evaluation run opens the thread, so here too the actor of that run
    // opens it.
    const discussionId = await world.openThread(
      pageOf(ids, trigger.page),
      residue,
      world.evaluationActor('thread'),
      trigger.opening,
    );
    const eventId = await world.personReplies(
      discussionId,
      trigger.words(tagOf(id), variantNumber(id)),
      residue,
    );
    // The snapshot is taken after the reply, because the comment through which the channel delivers
    // the person's words is not the run's own.
    const [before, memoryBefore] = await Promise.all([
      world.snapshots(ids, false),
      world.memoryStates(residue),
    ]);
    const window = await world.claimWindowFor(eventId);

    expectMode(window.envelope, 'event_evaluation', 'reply');

    const trace = await world.run(window.envelope, window.provenance, residue);

    await window.conclude();

    return world.evidenceFor(
      'reply',
      trace,
      ids,
      before,
      discussionId,
      await this.memoryAround(memoryBefore.states, residue),
    );
  }

  /**
   * Runs a recheck: the deadline moves closer, the continuation the first run wrote comes due, and
   * the run proceeds the way the scheduler would conduct it. What wakes is the continuation the run
   * wrote, found by its id, not whatever sits on the thread.
   */
  async recheck(
    ids: Ids,
    task: string,
    detection: Evidence6,
    residue: Residue,
  ): Promise<Evidence6 | null> {
    const { world } = this;
    const wakeReasons: readonly string[] = reasonsOf('wake');
    const wake = wakeOf(detection, Object.values(ids), wakeReasons);

    if (wake === undefined) return null;

    await world.moveDeadline(task, CHAIN_MOVED_DEADLINE_DAYS);

    const check = await world.claimCheck(wake.id);

    expectMode(check.envelope, 'scheduled_recheck', 'R2');

    const [before, memoryBefore] = await Promise.all([
      world.snapshots(ids, false),
      world.memoryStates(residue),
    ]);
    const trace = await world.run(check.envelope, check.provenance, residue);

    await check.conclude();

    return world.evidenceFor(
      'R2',
      trace,
      ids,
      before,
      wake.discussionId,
      await this.memoryAround(memoryBefore.states, residue),
    );
  }

  clean(residue: Residue): Promise<readonly string[]> {
    return this.world.clean(residue);
  }
}
