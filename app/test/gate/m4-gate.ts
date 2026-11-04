import { randomInt, randomUUID } from 'node:crypto';
import { qualified } from '../../src/claude/perimeter';
import { messageOf } from '../../src/platform/error/message-of';
import { TraceView } from '../../src/runs/run-traces';
import { eventEnvelope, recheckEnvelope } from '../../src/runs/trigger-envelope';
import {
  conducted,
  INFRASTRUCTURE_RETRIES,
  InfrastructureError,
  runCeilingUsd,
  unreached,
  type Standing,
  type Trial,
} from './gate-attempts';
import type { GateResult } from './gate-boot';
import { cleanupVerdict, Residue } from './gate-cleanup';
import { GateSession } from './gate-session';
import { claimOf, ScenarioClaim, ScenarioEvidence } from './m4-claims';
import { INBOX_SCENARIOS, Scenario, ScenarioId } from './m4-scenarios';
import { GateWorld } from './m4-world';

/**
 * One attempt at a scenario: the claim and the details it can be read from. `error` is set when the
 * claim was not reached (an exception, a run that was deferred). An attempt that did not reach its
 * claim proves nothing.
 */
interface Attempt {
  readonly ok: boolean;
  readonly detail: unknown;
  readonly run?: { readonly id: string; readonly status: string; readonly reason: string | null };
  readonly error?: string;
}

interface Verdict {
  readonly proves: readonly string[];
  /** `status === 'proven'`: the scenario is proven, not merely unrefuted. */
  readonly ok: boolean;
  readonly status: Standing;
  /** All the attempts, not only the last: a failure followed by a retry shows in the verdict. */
  readonly attempts: readonly Attempt[];
}

/** What the gate needs from a scenario: to go through it once and say how it ended. */
type Conduct = (world: GateWorld, residue: Residue) => Promise<Attempt>;

/**
 * Builds the instructions for a run with an invalid conclusion: the run closes the item but
 * returns evidence for something unread.
 */
function invalidInstructions(itemId: string): string {
  const unread = '00000000-0000-4000-8000-000000000000';

  return [
    'You are the M4 acceptance gate of the Personal Management System runtime. This is a mechanical check of how an',
    'invalid result is handled, so follow the steps literally even where they look wrong.',
    'Do exactly these steps, each once, in this order, and call no other tool:',
    `1. Call ${qualified('app', 'close_inbox_item')} with inbox_page_id "${itemId}", reason "trash" and comment "Gate M4: цього коментаря не мусить бути".`,
    '2. Return the structured result: outcome "gate_check", operating_phase ["Clarify"], scope ' +
      `{ "object_type": "inbox_item", "object_id": "${itemId}" } and one detection of type ` +
      '"dependency" with claim "Evidence this run never read", why_now "M4 acceptance gate" and ' +
      `the only evidence { "server": "notion", "ref": "${unread}" }, counterevidence_checked ` +
      '["Mechanical check: nothing else read"] and an empty array for uncertainties.',
  ].join('\n');
}

/**
 * Returns the conduct for the run of an Inbox item: the item, the run through the Skill, and what
 * it left in Notion.
 */
function inboxConduct(scenario: Scenario): Conduct {
  return async (world, residue) => {
    for (const fixture of scenario.fixtures ?? []) {
      await world.putTask(fixture, residue);
    }

    if (scenario.fixtures !== undefined) await world.settle();

    const bystanders: string[] = [];

    for (let index = 0; index < (scenario.bystanders ?? 0); index += 1) {
      bystanders.push(
        await world.putItem(
          `Сторонній запис ${index + 1}`,
          'Цей запис ні до чого не стосується і лишається як є.',
          residue,
        ),
      );
    }

    const run = String(randomInt(1_000, 10_000));
    const itemId = await world.putItem(
      scenario.title.replaceAll('{run}', run),
      scenario.text?.replaceAll('{run}', run),
      residue,
    );
    const trace = await world.run(
      world.inboxEnvelope(itemId),
      { origin: 'inbox_capture' },
      residue,
    );

    return attemptOf(scenario.id, world, trace, itemId, bystanders);
  };
}

function invalidConduct(): Conduct {
  return async (world, residue) => {
    const itemId = await world.putItem(
      'Невалідний висновок',
      'Запис для перевірки: після невалідного висновку він лишається цілим.',
      residue,
    );
    const trace = await world.run(
      world.inboxEnvelope(itemId),
      { origin: 'inbox_capture' },
      residue,
      { instructions: invalidInstructions(itemId) },
    );

    return attemptOf('12_invalid_result', world, trace, itemId, []);
  };
}

/**
 * Returns the conduct for the person's reply to a system message: the reply in the thread and a
 * snooze until Monday.
 */
function channelReplyConduct(): Conduct {
  return async (world, residue) => {
    const taskId = await world.putTask(
      { name: 'Підготувати звіт для банку', status: 'Next Action' },
      residue,
    );
    const discussionId = await world.openThread(taskId, residue);
    const messageId = await world.putSystemMessage(discussionId, residue);
    const updateId = world.telegramId();

    await world.sendUpdate('Відклади це до понеділка', updateId, messageId);

    const window = await world.claimWindowFor(`telegram:${updateId}`);
    const trace = await world.run(window.envelope, window.provenance, residue);

    await window.conclude();

    return attemptOf('10_channel_reply_snooze', world, trace, taskId, [], discussionId);
  };
}

/**
 * Returns the conduct for a Task change with nothing to tell the person: `event_evaluation` must
 * stay silent.
 */
function eventQuietConduct(): Conduct {
  return async (world, residue) => {
    const taskId = await world.putTask(
      { name: 'Купити квиток на потяг до Львова', status: 'Next Action' },
      residue,
    );
    const trace = await world.run(
      eventEnvelope('event_evaluation', {
        type: 'page.properties_updated',
        event_types: ['page.properties_updated'],
        event_id: `gate-m4-${randomUUID()}`,
        timestamp: new Date().toISOString(),
        entity_id: taskId,
        page_id: taskId,
        updated_property_ids: [],
      }),
      { origin: 'evaluation_window' },
      residue,
    );

    return attemptOf('13_event_quiet', world, trace, taskId, []);
  };
}

/**
 * Returns the conduct for a wait that holds: `scheduled_recheck` reads the state again and wakes
 * no one.
 */
function recheckQuietConduct(): Conduct {
  return async (world, residue) => {
    const taskId = await world.putTask(
      { name: 'Дочекатися відповіді бухгалтера щодо звіту', status: 'Waiting For' },
      residue,
    );
    const discussionId = await world.openThread(taskId, residue);
    const trace = await world.run(
      recheckEnvelope({
        event_id: `gate-m4-${randomUUID()}:1`,
        discussion_id: discussionId,
        page_id: taskId,
        reason_code: 'await_external_event',
      }),
      { origin: 'scheduled_check', reasonCode: 'await_external_event' },
      residue,
    );

    return attemptOf('14_recheck_quiet', world, trace, taskId, [], discussionId);
  };
}

/** Reads what the run left in the world and says whether that proves the scenario. */
async function attemptOf(
  id: ScenarioId,
  world: GateWorld,
  trace: TraceView,
  itemId: string,
  bystanders: readonly string[],
  discussionId?: string,
): Promise<Attempt> {
  const unfinished = unreached(trace, world.refusedQueries(trace.id));

  if (unfinished !== null) throw new InfrastructureError(`${id}: ${unfinished}`);

  const effects = trace.runtimeEffects ?? [];
  const idsOf = (kind: string): string[] =>
    effects.filter((effect) => effect.kind === kind).map((effect) => effect.id);
  const created = idsOf('page_created');
  const evidence: ScenarioEvidence = {
    trace,
    item: await world.itemState(itemId, idsOf('comment')),
    bystanders: await Promise.all(bystanders.map((pageId) => world.bystanderState(pageId))),
    created: await Promise.all(created.map((pageId) => world.taskState(pageId))),
    gbrainWrites: world.gbrainWritesOf(trace),
    bot: await world.bot(),
    continuations: discussionId === undefined ? [] : await world.continuationsOn(discussionId),
    timeZone: world.timeZone(),
  };
  const claim: ScenarioClaim = claimOf(id, evidence);

  return {
    ok: claim.ok,
    detail: claim.detail,
    run: { id: trace.id, status: trace.status, reason: trace.reason },
  };
}

function trialOf(attempt: Attempt): Trial {
  if (attempt.error !== undefined) return 'errored';

  return attempt.ok ? 'held' : 'broke';
}

/**
 * Conducts one scenario and returns its verdict, cleaning up after every attempt. Only a failure
 * while conducting is repeated, because a violated claim is a result, not noise, and a scenario
 * that passed on a repeat after a violation is not proven.
 */
async function scenarioVerdict(
  world: GateWorld,
  proves: readonly string[],
  conduct: Conduct,
): Promise<Verdict> {
  const once = async (): Promise<Attempt> => {
    const residue = world.begin();

    try {
      return await conduct(world, residue);
    } catch (error) {
      return {
        ok: false,
        detail: `the scenario threw: ${messageOf(error)}`,
        error: messageOf(error),
      };
    } finally {
      await world.clean(residue);
    }
  };
  const { attempts, standing } = await conducted(once, trialOf);

  return { proves, ok: standing === 'proven', status: standing, attempts };
}

/**
 * Conducts gate M4 and says whether everything is proven: fourteen scenarios through a second App
 * instance, with the runner enabled and the real Skill, and the verdict as JSON on stdout. Each
 * scenario cleans up after itself.
 */
export async function runGate(): Promise<GateResult> {
  const session = await GateSession.open('m4');

  try {
    await session.ready();
    await session.assertRunnable();

    const world = new GateWorld(session.app, 'm4');

    session.holdAgainstAbort(() => world.abandon());

    const scenarios: Partial<Record<ScenarioId, Verdict>> = {};
    const note = (id: ScenarioId, verdict: Verdict): void => {
      scenarios[id] = verdict;
      process.stderr.write(
        `m4 gate: ${id} ${verdict.ok ? 'ok' : `NOT PROVEN (${verdict.status})`}\n`,
      );
    };

    for (const scenario of INBOX_SCENARIOS) {
      note(scenario.id, await scenarioVerdict(world, scenario.proves, inboxConduct(scenario)));
    }

    note(
      '10_channel_reply_snooze',
      await scenarioVerdict(world, ['INV-312', 'INV-089'], channelReplyConduct()),
    );
    note('12_invalid_result', await scenarioVerdict(world, ['INV-035'], invalidConduct()));
    note('13_event_quiet', await scenarioVerdict(world, ['SCEN-19-12'], eventQuietConduct()));
    note('14_recheck_quiet', await scenarioVerdict(world, ['SCEN-21-4'], recheckQuietConduct()));

    const ok = Object.values(scenarios).every((verdict) => verdict.ok);
    const cleanup = cleanupVerdict(world.leftovers);

    session.report({
      gate: 'M4',
      at: new Date().toISOString(),
      ok,
      cleanup,
      cost: `up to ${runCeilingUsd()} USD of plan quota per run, ${
        INBOX_SCENARIOS.length + 4
      } runs at best, at most ${
        (INBOX_SCENARIOS.length + 4) * (INFRASTRUCTURE_RETRIES + 1)
      } (a retry follows an infrastructure error only)`,
      scenarios,
    });

    return { ok, clean: cleanup.clean };
  } finally {
    await session.close();
  }
}
