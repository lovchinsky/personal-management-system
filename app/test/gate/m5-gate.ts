import { randomInt, randomUUID } from 'node:crypto';
import { addHours } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { availableNowCandidacy } from '../../src/methodology/available-now';
import { dependencyConsistency, dependencyState } from '../../src/methodology/dependency';
import { pausedCommitments } from '../../src/methodology/paused-commitments';
import { closureObligations } from '../../src/methodology/project-closure';
import { DecodedRecord } from '../../src/notion/semantics/decoded-record';
import { messageOf } from '../../src/platform/error/message-of';
import { RunActor } from '../../src/runs/actor';
import {
  conducted,
  expectMode,
  INFRASTRUCTURE_RETRIES,
  runCeilingUsd,
  summaryOf,
} from './gate-attempts';
import type { GateResult } from './gate-boot';
import { allOf, Claim, Evidence } from './gate-claims';
import { cleanupVerdict, Residue, UNMANAGED } from './gate-cleanup';
import { GateSession } from './gate-session';
import { plantAnchor } from './gbrain-fixture';
import {
  alternativePathClaim,
  blockedFigureOf,
  closureDecisionClaim,
  contradictionClaim,
  dependencyRaisedClaim,
  dependencySliceClaim,
  healthyAreaOfFocusClaim,
  identityClaim,
  pausedProjectClaim,
  terminalProjectClaim,
  terminalReplyClaim,
  UNOBSERVED_CLOSURE,
  unreadableEvidenceClaim,
} from './m5-claims';
import { GateOptions } from './m5-options';
import {
  namesOf,
  PREFLIGHT_BLOCKERS,
  PREFLIGHT_DEPENDENCIES,
  PREFLIGHT_WORLD,
  S1_PERSON_REPLY,
  S1_WORLD,
  S2_ALTERNATIVE_PATH,
  S3_PAUSED_PROJECT,
  S4_PERSON_REPLY,
  S4_TERMINAL_PROJECT,
  S5_STRUCTURAL_CONTRADICTION,
  S6_DECISION,
  s6World,
  S7_IDENTITY_NO_SCORE,
  ScenarioId,
  SCENARIOS,
  SingleRun,
  T2B_AREA_OF_FOCUS_HEALTHY,
  T2C_EVIDENCE_UNREADABLE,
  T2C_PERSON_STATEMENT,
  type ScenarioInfo,
} from './m5-scenarios';
import { noteOf, runsOf, trialOf, type Attempt, type RunNote, type Verdict } from './m5-verdict';
import { Ids, pageOf, ScenarioWorld } from './scenario-world';

interface Context {
  readonly world: ScenarioWorld;
  readonly residue: Residue;
  readonly options: GateOptions;
  /** A scenario run is recorded in the verdict: it is read in the trace by its id. */
  readonly note: (step: string, evidence: Evidence) => void;
}

/** What a scenario ended with: a claim, or steps there was no one to conduct. */
type Outcome = { readonly claim: Claim } | { readonly waiting: readonly string[] };

type Conduct = (context: Context) => Promise<Outcome>;

/** Builds a single-run scenario: a world, an event, one run, and a claim about what it left. */
function singleRun(
  spec: SingleRun,
  fixtureReads: (world: ScenarioWorld, ids: Ids) => Promise<string | null>,
  claim: (evidence: Evidence) => Claim,
): Conduct {
  return async ({ world, residue, note }) => {
    const ids = await world.build(spec.world, residue);
    const unexpected = await fixtureReads(world, ids);

    if (unexpected !== null) {
      throw new Error(`the fixture does not read as designed: ${unexpected}`);
    }

    const before = await world.snapshots(ids);
    const trace = await world.run(
      world.trigger(pageOf(ids, spec.trigger.page)),
      { origin: 'operator' },
      residue,
    );
    const evidence = await world.evidenceOf('run', trace, ids, before);

    note('run', evidence);

    return { claim: claim(evidence) };
  };
}

/** Reports whether, under the methodology rules, a world just created reads as designed. */
function readsAs(problems: readonly string[]): string | null {
  return problems.length === 0 ? null : problems.join('; ');
}

/** Maps the Tasks read by `pageId`, the form the methodology rules ask for instead of an array. */
function known(
  tasks: readonly DecodedRecord<'task'>[],
): ReadonlyMap<string, DecodedRecord<'task'>> {
  return new Map(tasks.map((task): [string, DecodedRecord<'task'>] => [task.pageId, task]));
}

const alternativePath = singleRun(
  S2_ALTERNATIVE_PATH,
  async (world, ids) => {
    const records = world.recordReader();
    const alternative = await records.read('task', pageOf(ids, 'alternative'));
    const project = await records.read('project', pageOf(ids, 'project'));
    const candidacy = availableNowCandidacy(alternative, new Map([[project.pageId, project]]));

    return readsAs(
      candidacy.state === 'candidate'
        ? []
        : ['the alternative Task is not a candidate of the Available Now'],
    );
  },
  alternativePathClaim,
);

const pausedProject = singleRun(
  S3_PAUSED_PROJECT,
  async (world, ids) => {
    const records = world.recordReader();
    const project = await records.read('project', pageOf(ids, 'project'));
    const [plain, checking, committed] = await Promise.all(
      ['plain', 'checking', 'committed'].map((key) => records.read('task', pageOf(ids, key))),
    );
    const candidacy = availableNowCandidacy(plain, new Map([[project.pageId, project]]));
    const commitments = pausedCommitments(project, known([plain, checking, committed]));
    const named =
      commitments.state === 'to_decide' ? commitments.commitments.map((item) => item.taskId) : [];

    return readsAs([
      ...(candidacy.state === 'excluded' && candidacy.reason === 'project_paused'
        ? []
        : ['a Paused Project does not keep its Next Action out of the Available Now']),
      // `checking` is a check date: the pause suppresses it legitimately, and it is not a
      // candidate.
      ...(named.length === 1 && named[0] === committed.pageId
        ? []
        : ['the Paused Project does not name `committed`, and only it, as a commitment']),
    ]);
  },
  (evidence) =>
    pausedProjectClaim(evidence, { commitments: namesOf(S3_PAUSED_PROJECT.world, ['committed']) }),
);

const healthyAreaOfFocus = singleRun(
  T2B_AREA_OF_FOCUS_HEALTHY,
  () => Promise.resolve(null),
  healthyAreaOfFocusClaim,
);

const identityNoScore = singleRun(S7_IDENTITY_NO_SCORE, () => Promise.resolve(null), identityClaim);

const contradiction = singleRun(
  S5_STRUCTURAL_CONTRADICTION,
  async (world, ids) => {
    const records = world.recordReader();
    // The body is read, because the rule says “nothing to wait for” only over an emptiness that
    // was read.
    const dependent = await records.read('task', pageOf(ids, 'dependent'), { withBody: true });
    const blocker = await records.read('task', pageOf(ids, 'blocker'));
    const consistency = dependencyConsistency(dependent, known([blocker]));

    return readsAs(
      consistency.state === 'contradiction' &&
        consistency.kind === 'waiting_for_all_blockers_resolved'
        ? []
        : ['the dependent Task does not read as Waiting For with a resolved blocker'],
    );
  },
  contradictionClaim,
);

/** The S4 Tasks the comment must name: the unfinished ones, by the scenario's keys. */
const S4_OBLIGATION_KEYS = ['next', 'waiting', 'someday'] as const;
const S4_TASK_KEYS = [...S4_OBLIGATION_KEYS, 'finished'] as const;

/** S4: a closed Project. First the system asks, then the person names what each Task becomes. */
const terminalProject: Conduct = async ({ world, residue, note }) => {
  const ids = await world.build(S4_TERMINAL_PROJECT.world, residue);
  const records = world.recordReader();
  const project = await records.read('project', pageOf(ids, 'project'));
  const tasks = await Promise.all(
    S4_TASK_KEYS.map((key) => records.read('task', pageOf(ids, key))),
  );
  const closure = closureObligations(project, known(tasks));
  const named = closure.state === 'unsettled' ? closure.obligations.map((item) => item.taskId) : [];
  const expected = S4_OBLIGATION_KEYS.map((key) => pageOf(ids, key));

  if (JSON.stringify([...named].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(
      'the fixture does not read as designed: the closed Project has other obligations',
    );
  }

  const before = await world.snapshots(ids);
  const first = await world.run(
    world.trigger(pageOf(ids, 'project')),
    { origin: 'operator' },
    residue,
  );
  const asked = await world.evidenceOf('terminal', first, ids, before);

  note('terminal', asked);

  const initial = terminalProjectClaim(asked, {
    obligationNames: namesOf(S4_TERMINAL_PROJECT.world, S4_OBLIGATION_KEYS),
    taskKeys: S4_TASK_KEYS,
  });

  // The person's reply is added to the thread the model itself opened, not to a gate thread. That
  // is how it works in normal operation.
  const discussionId = await world.threadOn(pageOf(ids, 'project'), residue);

  if (discussionId === null) return { claim: initial };

  const eventId = await world.personReplies(discussionId, S4_PERSON_REPLY, residue);
  const beforeReply = await world.snapshots(ids);
  const window = await world.claimWindowFor(eventId);

  expectMode(window.envelope, 'event_evaluation', 'reply');

  const second = await world.run(window.envelope, window.provenance, residue);

  await window.conclude();

  const answered = await world.evidenceOf('reply', second, ids, beforeReply, discussionId);

  note('reply', answered);

  return {
    claim: allOf(
      initial,
      terminalReplyClaim(answered, {
        outcomes: { next: 'Done', waiting: 'Canceled' },
        untouched: ['someday', 'finished'],
      }),
    ),
  };
};

/**
 * T2c: the person speaks about the Key Result evidence in their own words; the system writes
 * nothing to the Objective.
 */
const unreadableEvidence: Conduct = async ({ world, residue, note }) => {
  const ids = await world.build(T2C_EVIDENCE_UNREADABLE, residue);
  // In normal operation an evaluation run opens the thread, so here too the thread is opened by
  // that run's actor.
  const discussionId = await world.openThread(
    pageOf(ids, 'objective'),
    residue,
    world.evaluationActor('t2c'),
  );
  const eventId = await world.personReplies(discussionId, T2C_PERSON_STATEMENT, residue);
  const before = await world.snapshots(ids);
  const window = await world.claimWindowFor(eventId);

  expectMode(window.envelope, 'event_evaluation', 'reply');

  const trace = await world.run(window.envelope, window.provenance, residue);

  await window.conclude();

  const evidence = await world.evidenceOf('reply', trace, ids, before, discussionId);

  note('reply', evidence);

  return { claim: unreadableEvidenceClaim(evidence) };
};

/**
 * For a resolved thread, the resolution producer schedules a continuation with the closure
 * reason, and the closure run comes due and takes the same path as in normal operation. The
 * closure request must go through, and the run must be in closure mode: otherwise something other
 * than closure would be tested.
 */
async function closureOf(
  { world, residue, note }: Context,
  ids: Ids,
  discussionId: string,
  notionPageId: string,
): Promise<Evidence> {
  const requested = await world.requestClosure({ discussionId, notionPageId });

  if (requested !== 'requested') {
    throw new Error('closure: the thread already had a closure request open');
  }

  const before = await world.snapshots(ids);
  const check = await world.claimCheckFor(discussionId, 'closure');

  expectMode(check.envelope, 'closure_processing', 'closure');

  const trace = await world.run(check.envelope, check.provenance, residue);

  await check.conclude();

  const evidence = await world.evidenceOf('closure', trace, ids, before, discussionId);

  note('closure', evidence);

  return evidence;
}

/**
 * S6: the person made a decision that must influence what follows, and the thread is resolved. The
 * closure writes a fact or an event to memory. Only the person can resolve the thread.
 */
const closureDecision: Conduct = async (context) => {
  const { world, residue, options } = context;
  const run = String(randomInt(1_000, 10_000));
  const pages = s6World(run);
  const ids = await world.build(pages, residue);

  await world.plantAnchor(pages, ids, residue);

  const discussionId = await world.openThread(pageOf(ids, 'task'), residue);

  await world.personReplies(discussionId, S6_DECISION.replaceAll('{run}', run), residue);

  if (!options.manual || !(await world.awaitResolved(pageOf(ids, 'task'), discussionId))) {
    return { waiting: [UNOBSERVED_CLOSURE] };
  }

  const evidence = await closureOf(context, ids, discussionId, pageOf(ids, 'task'));

  return { claim: closureDecisionClaim(evidence) };
};

/**
 * S1: the end-to-end dependency flow. Each step takes the same path as in normal operation: an
 * event wakes the run, the person's reply arrives through the channel, the person decides on
 * approval, the continuation comes due, and the resolution producer schedules the closure.
 */
const dependencySlice: Conduct = async (context) => {
  const { world, residue, options, note } = context;
  const ids = await world.build(S1_WORLD, residue);

  await world.plantAnchor(S1_WORLD, ids, residue);

  const task = pageOf(ids, 'waiting');

  const before = await world.snapshots(ids);
  const detectionTrace = await world.run(world.trigger(task), { origin: 'operator' }, residue);
  // The run itself opens the thread: the person replies in the thread the system opened.
  const discussionId = await world.threadOn(task, residue);
  const detection = await world.evidenceOf(
    'detection',
    detectionTrace,
    ids,
    before,
    discussionId ?? undefined,
  );

  note('detection', detection);

  if (discussionId === null || detection.continuations.length === 0) {
    return { claim: dependencyRaisedClaim(detection) };
  }

  const eventId = await world.personReplies(discussionId, S1_PERSON_REPLY, residue);
  const beforeReply = await world.snapshots(ids);
  const window = await world.claimWindowFor(eventId);

  expectMode(window.envelope, 'event_evaluation', 'reply');

  const replyTrace = await world.run(window.envelope, window.provenance, residue);

  await window.conclude();

  const reply = await world.evidenceOf('reply', replyTrace, ids, beforeReply, discussionId);

  note('reply', reply);

  const [proposal] = reply.proposals;
  const proposalStatus =
    proposal === undefined ? 'none' : await world.approveAndExecute(proposal.id, residue);
  const approvedTask = (await world.snapshots(ids)).waiting;

  if (approvedTask === undefined) throw new Error('the waiting Task disappeared');

  const check = await world.claimCheckFor(discussionId, 'wake');

  expectMode(check.envelope, 'scheduled_recheck', 'recheck');

  const beforeRecheck = await world.snapshots(ids);
  const recheckTrace = await world.run(check.envelope, check.provenance, residue);

  await check.conclude();

  const recheck = await world.evidenceOf('recheck', recheckTrace, ids, beforeRecheck, discussionId);

  note('recheck', recheck);

  const closure =
    options.manual && (await world.awaitResolved(task, discussionId))
      ? await closureOf(context, ids, discussionId, task)
      : null;

  return {
    claim: dependencySliceClaim({
      detection,
      reply,
      approval: { proposalStatus, task: approvedTask, bot: detection.bot },
      recheck,
      closure,
    }),
  };
};

const CONDUCTS: Readonly<Record<ScenarioId, Conduct>> = {
  S1_dependency_slice: dependencySlice,
  S2_alternative_path: alternativePath,
  S3_paused_project: pausedProject,
  S4_terminal_project: terminalProject,
  S5_structural_contradiction: contradiction,
  S6_closure_decision: closureDecision,
  S7_identity_no_score: identityNoScore,
  T2b_area_of_focus_healthy: healthyAreaOfFocus,
  T2c_evidence_unreadable: unreadableEvidence,
};

/**
 * Conducts one scenario and returns its verdict, cleaning up after every attempt. Only a failure
 * while conducting is repeated, because a violated claim is a result, not noise.
 */
async function conductedScenario(
  info: ScenarioInfo,
  world: ScenarioWorld,
  options: GateOptions,
): Promise<Verdict> {
  const once = async (): Promise<Attempt> => {
    const residue = world.begin();
    const runs: RunNote[] = [];
    const note = (step: string, evidence: Evidence): void => {
      runs.push(noteOf(step, evidence));
    };

    try {
      const outcome = await CONDUCTS[info.id]({ world, residue, options, note });

      return 'claim' in outcome
        ? { kind: 'judged', claim: outcome.claim, runs }
        : { kind: 'waiting', unobserved: outcome.waiting, runs };
    } catch (error) {
      return { kind: 'error', error: messageOf(error), runs };
    } finally {
      await world.clean(residue);
    }
  };
  const { attempts, standing } = await conducted(once, trialOf);

  return { tier: info.tier, proves: info.proves, status: standing, attempts };
}

/**
 * The result of one check ahead of the first quota. `skipped` means there is nothing to check
 * against (the signal is not bound in this workspace). A skipped check is neither agreement nor
 * failure, and the verdict says so.
 */
interface Check {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: unknown;
  readonly skipped?: string;
}

/**
 * The workspace computes `Blocked` with its own formula, while the rule derives the state from
 * the relation and the blockers' statuses. A discrepancy is formula drift, and it shows before the
 * first run.
 */
async function dependencyChecks(world: ScenarioWorld, ids: Ids): Promise<Check[]> {
  const records = world.recordReader();
  const blockers = new Map<string, DecodedRecord<'task'>>();

  for (const key of PREFLIGHT_BLOCKERS) {
    const blocker = await records.read('task', pageOf(ids, key));

    blockers.set(blocker.pageId, blocker);
  }

  const checks: Check[] = [];

  for (const [key, expected] of PREFLIGHT_DEPENDENCIES) {
    const dependent = await records.read('task', pageOf(ids, key));
    const { state } = dependencyState(dependent, blockers);
    const figure = blockedFigureOf(dependent.signals.blocked);

    checks.push(
      {
        check: `the dependency rule gives ${expected} for ${key}`,
        ok: state === expected,
        detail: { rule: state, expected },
      },
      figure.kind === 'not_bound'
        ? {
            check: `the workspace's Blocked figure agrees with the rule on ${key}`,
            ok: true,
            skipped: 'the Blocked signal is not bound in this workspace: nothing to compare with',
            detail: { rule: state, workspace: figure },
          }
        : {
            check: `the workspace's Blocked figure agrees with the rule on ${key}`,
            ok:
              figure.kind !== 'unreadable' && (figure.kind === 'blocked') === (state === 'blocked'),
            detail: { rule: state, workspace: figure },
          },
    );
  }

  return checks;
}

/**
 * An approved status change that clears the date reaches Notion as a system write: the proposal,
 * the person's approval, the executor and a read back, without the model.
 */
async function executorCheck(world: ScenarioWorld, ids: Ids, residue: Residue): Promise<Check> {
  const actor: RunActor = world.evaluationActor('preflight');
  const approvals = world.service(ApprovalsService);
  const target = pageOf(ids, 'byDone');
  const status = world.statusProperty();
  const date = world.dateProperty();
  const planned = (await world.snapshots({ target })).target?.date;

  if (planned === null || planned === undefined) {
    return {
      check: 'an approved status change reaches Notion',
      ok: false,
      detail: 'no planned date',
    };
  }

  const proposal = await approvals.check(actor, {
    effects: [
      {
        kind: 'property_write',
        pageId: target,
        propertyId: status,
        value: { kind: 'option', option: 'Next Action' },
      },
      { kind: 'property_write', pageId: target, propertyId: date, value: { kind: 'clear' } },
    ],
    preconditions: [
      {
        kind: 'property_reads_as',
        pageId: target,
        propertyId: status,
        value: { kind: 'option', option: 'Waiting For' },
      },
      {
        kind: 'property_reads_as',
        pageId: target,
        propertyId: date,
        value: { kind: 'date', start: planned, end: null },
      },
    ],
  });
  const row = await approvals.record(actor, proposal);

  residue.runs.push(actor.runId);

  const fate = await world.approveAndExecute(row.id, residue);
  const after = (await world.snapshots({ target })).target;

  return {
    check: 'an approved status change reaches Notion as a system write',
    ok: fate === 'executed' && after?.status === 'Next Action' && after.date === null,
    detail: { fate, status: after?.status ?? null, date: after?.date ?? null },
  };
}

/** A thread's closure row wakes the closure, not a recheck. */
async function closureCheck(world: ScenarioWorld, ids: Ids, residue: Residue): Promise<Check> {
  const page = pageOf(ids, 'byOpen');
  const discussionId = await world.openThread(page, residue);
  const outcome = await world.requestClosure({ discussionId, notionPageId: page });
  const check = await world.claimCheckFor(discussionId, 'closure');

  await check.conclude();

  return {
    check: 'a closure request wakes the closure of the thread',
    ok: outcome === 'requested' && check.envelope.mode === 'closure_processing',
    detail: { outcome, mode: check.envelope.mode },
  };
}

/**
 * A closure and a wake of one thread do not interfere with each other: the closure request does
 * not move the wake, the closure enters a run with its own mode, and the wake afterwards stays as
 * it was.
 */
async function coexistenceCheck(world: ScenarioWorld, ids: Ids, residue: Residue): Promise<Check> {
  const page = pageOf(ids, 'failed');
  const discussionId = await world.openThread(page, residue);
  const thread = { discussionId, notionPageId: page };

  await world.scheduleWake(thread, addHours(new Date(), 3));

  const wake = await world.continuationsOn(discussionId);
  const outcome = await world.requestClosure(thread);
  const again = await world.requestClosure(thread);
  const check = await world.claimCheckFor(discussionId, 'closure');

  await check.conclude();

  const after = await world.continuationsOn(discussionId);

  return {
    check: 'a closure and a wake-up of one thread do not move each other',
    ok:
      outcome === 'requested' &&
      again === 'already_requested' &&
      check.envelope.mode === 'closure_processing' &&
      wake.length === 1 &&
      JSON.stringify(after) === JSON.stringify(wake),
    detail: { outcome, again, mode: check.envelope.mode, wake, after },
  };
}

/**
 * A person's reply in the channel reaches the gate's own window: the gate's webhook, the system
 * thread and the evaluation window are the path shared by the channel scenarios, and the model
 * takes no part in it.
 */
async function channelCheck(world: ScenarioWorld, ids: Ids, residue: Residue): Promise<Check> {
  const { ok, ...detail } = await world.channelReaches(pageOf(ids, 'byOpen'), residue);

  return { check: 'a reply in the channel opens a window of its own', ok, detail };
}

/**
 * The Project's anchor is written to GBrain, found by search on the Project id (the way the Skill
 * looks for it) and removed. It checks that the gate's client can write under `projects/…` and
 * delete, and that search sees the write. It does so before a scenario is built on it, so that S1
 * does not leave behind a page that cannot be cleaned up.
 */
async function gbrainCheck(world: ScenarioWorld): Promise<Check> {
  const check = 'the GBrain anchor page is written, found by the project id and removed';
  const residue = world.begin();
  let slug: string | null = null;
  let failure: string | null = null;

  try {
    slug = await plantAnchor(world.gbrain(), residue, {
      notionId: randomUUID(),
      projectName: 'Gate M5: перевірка якоря',
      paragraphs: ['Перевірка запису й пошуку anchor-а.'],
    });
  } catch (error) {
    failure = messageOf(error);
  }

  const left = await world.clean(residue);

  return failure === null && left.length === 0
    ? { check, ok: true, detail: { slug } }
    : { check, ok: false, detail: { failure, left } };
}

/**
 * Runs a model-free check, ahead of any quota: whether the created world reads the way the rules
 * read it, whether the executor writes what is approved, whether thread closure has a path of its
 * own, and whether GBrain accepts the anchor page. The GBrain step is needed only by the gate runs
 * that include S1, so its failure must not block the rest.
 */
async function preflight(world: ScenarioWorld, withGbrain: boolean): Promise<Check[]> {
  const residue = world.begin();

  try {
    const ids = await world.build(PREFLIGHT_WORLD, residue);

    return [
      ...(withGbrain ? [await gbrainCheck(world)] : []),
      ...(await dependencyChecks(world, ids)),
      await executorCheck(world, ids, residue),
      await closureCheck(world, ids, residue),
      await coexistenceCheck(world, ids, residue),
      await channelCheck(world, ids, residue),
    ];
  } catch (error) {
    return [{ check: 'preflight', ok: false, detail: messageOf(error) }];
  } finally {
    await world.clean(residue);
  }
}

/**
 * Conducts the scenarios one after another. It stops when runs have become impossible (plan quota,
 * a busy slot), because the rest would spend an attempt on the same cause.
 */
async function conductAll(
  selected: readonly ScenarioInfo[],
  world: ScenarioWorld,
  session: GateSession,
  options: GateOptions,
): Promise<{ scenarios: Partial<Record<ScenarioId, Verdict>>; stopped: string | null }> {
  const scenarios: Partial<Record<ScenarioId, Verdict>> = {};

  for (const scenario of selected) {
    try {
      await session.assertRunnable();
    } catch (error) {
      process.stderr.write(`m5 gate: stopped before ${scenario.id}: ${messageOf(error)}\n`);

      return { scenarios, stopped: messageOf(error) };
    }

    const verdict = await conductedScenario(scenario, world, options);

    scenarios[scenario.id] = verdict;
    process.stderr.write(`m5 gate: ${scenario.id} ${verdict.status}\n`);
  }

  return { scenarios, stopped: null };
}

/**
 * What gate M5 does not clean up: on top of the shared list, the deleted anchor of the S1 Project
 * in GBrain. The deletion is soft, so the anchor remains recoverable for some time.
 */
const M5_UNMANAGED: readonly string[] = [
  ...UNMANAGED,
  'GBrain anchor pages projects/<id> of the S1 world (soft-deleted: recoverable until GBrain purges them)',
];

/**
 * Conducts gate M5 and says whether everything is proven: a world in a real workspace, runs with
 * the real Skill through a second App instance, the verdict as JSON on stdout. Each scenario
 * cleans up after itself. Scenarios that need a person stay `not_proven` without a person, because
 * the absence of a step does not prove that the result is right. `proven` is one sample on one
 * input: the gate does not measure the model's instability.
 */
export async function runGate(options: GateOptions): Promise<GateResult> {
  const session = await GateSession.open('m5');

  try {
    await session.ready();

    const world = new ScenarioWorld(session.app, 'm5');

    session.holdAgainstAbort(() => world.abandon());

    const selected = SCENARIOS.filter(
      (scenario) =>
        !options.preflight &&
        (options.only === null ||
          options.only.some((prefix) => scenario.id.startsWith(`${prefix}_`))),
    );

    // A model-free check needs no slot; the scenarios do.
    if (selected.length > 0) await session.assertRunnable();

    const withGbrain =
      options.preflight || selected.some((scenario) => scenario.id === 'S1_dependency_slice');
    const checks = await preflight(world, withGbrain);
    const preflightOk = checks.every((check) => check.ok);
    const { scenarios, stopped } = preflightOk
      ? await conductAll(selected, world, session, options)
      : { scenarios: {}, stopped: null };

    if (!preflightOk) process.stderr.write('m5 gate: the preflight failed — no scenario was run\n');

    const blocking = Object.values(scenarios).filter((verdict) => verdict?.tier === 1);
    const ok =
      preflightOk &&
      blocking.length === selected.filter((scenario) => scenario.tier === 1).length &&
      blocking.every((verdict) => verdict?.status === 'proven');
    const runs = selected.reduce((sum, scenario) => sum + runsOf(scenario.id, options.manual), 0);
    const cleanup = cleanupVerdict(world.leftovers, M5_UNMANAGED);

    session.report({
      gate: 'M5',
      at: new Date().toISOString(),
      ok,
      cleanup,
      partial: options.only !== null || options.preflight,
      manual: options.manual,
      stopped,
      cost: `up to ${runCeilingUsd()} USD of plan quota per run, ${runs} runs at best, at most ${
        runs * (INFRASTRUCTURE_RETRIES + 1)
      } (a retry follows an infrastructure error only)`,
      preflight: checks,
      summary: summaryOf(scenarios),
      scenarios,
    });

    return { ok, clean: cleanup.clean };
  } finally {
    await session.close();
  }
}
