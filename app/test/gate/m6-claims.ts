import { z } from 'zod';
import { HARNESS_TOOLS } from '../../src/claude/perimeter';
import type { AttemptView, GbrainCall } from '../../src/claude/runner/run-tap';
import { mapStrings } from '../../src/platform/text/map-strings';
import type { TraceView } from '../../src/runs/run-traces';
import { MCP_TOOLSETS } from '../../src/runs/toolsets';
import {
  atMostOneNotification,
  common,
  followUpLead,
  noDirectGbrainWrites,
  noNewPages,
  raised,
  readGbrain,
  silent,
  statuses,
  wordsOfThe,
  type SingleClaim,
} from './claim-parts';
import {
  citedBy,
  cites,
  claimOf,
  deliveries,
  detectionsOf,
  detectionTypes,
  effect,
  holds,
  mentionsAny,
  observed,
  pageIdOf,
  perimeter,
  recognition,
  sameId,
  untouched,
  type Claim,
} from './gate-claims';
import {
  commentsOn,
  inThread,
  NOT_OBSERVED,
  offeredProposals,
  textsOf,
  type Evidence6,
  type Notice,
} from './m6-evidence';
import { CLIENT_STEM, CODEWORD_STEM, type ScenarioId } from './m6-scenarios';
import { M7_CLAIMS } from './m7-claims';
import type { NotionRead } from './run-reads';

/** Combines several claims of one scenario into one; each observation is prefixed with its step. */
export function steps(...named: readonly (readonly [string, Claim])[]): Claim {
  return {
    ok: named.every(([, claim]) => claim.ok),
    observations: named.flatMap(([step, claim]) =>
      claim.observations.map((observation) => ({
        ...observation,
        item: `${step}: ${observation.item}`,
      })),
    ),
    unobserved: named.flatMap(([step, claim]) =>
      claim.unobserved.map((reason) => `${step}: ${reason}`),
    ),
  };
}

/**
 * Words that must not be used to diagnose the person: no conclusion about their character or state
 * from a single episode (`SCEN-19-45`, criterion 2). The list follows the mechanisms the policy
 * names in `docs/3-policy.md` § “Limit of self-regulation inference” (perfectionism, emotional
 * avoidance, boredom, low energy, value conflict), and the direct diagnoses. It is a mark for
 * reading, not an observation: a substring match does not tell “це не лінощі” (it's not laziness)
 * from a diagnosis. The only verifiable criterion of M6 cannot be attested that way, so the
 * verdict shows the words, and `accepted` never occurs unless the flagged texts have been read.
 */
export const DIAGNOSIS_WORDS: readonly string[] = [
  // Word stems, so that inflected forms are found too
  'перфекціон',
  'лінь',
  'лінощ',
  'лінив',
  'прокрастин',
  'недисциплін',
  'слабка воля',
  'слабкої волі',
  'безвідповідальн',
  'вигоран',
  'уника',
  'ухиля',
  'відкладаєш',
  'відкладаєте',
  'мотивац',
  'енергі',
  'нудн',
  'нудьг',
  'втом',
  'конфлікт цінност',
  'емоційн',
  // English
  'perfectionis',
  'lazy',
  'laziness',
  'procrastinat',
  'undisciplined',
  'lack of discipline',
  'willpower',
  'irresponsible',
  'burnout',
  'motivat',
  'bored',
  'low energy',
  'anxiety',
  'value conflict',
];

/** Matches a word start only: “втом” finds “втомлений” (tired) but not “автомобіль” (car). */
const asWordStart = (word: string): RegExp =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');

const DIAGNOSIS_PATTERNS: readonly (readonly [string, RegExp])[] = DIAGNOSIS_WORDS.map((word) => [
  word,
  asWordStart(word),
]);

/** Finds the diagnostic words that occur in the texts. */
export function diagnosisIn(texts: readonly string[]): string[] {
  const lowered = texts.map((text) => text.toLowerCase());

  return DIAGNOSIS_PATTERNS.filter(([, pattern]) => lowered.some((text) => pattern.test(text))).map(
    ([word]) => word,
  );
}

/** Notion tools for looking up an equivalent: search and query, not reading a known page. */
const LOOKUP_TOOLS: ReadonlySet<string> = new Set(
  ['search', 'ai_search', 'query'].flatMap(
    (capability) => MCP_TOOLSETS.notion.capabilities[capability] ?? [],
  ),
);

function lookedForEquivalent(evidence: Evidence6): boolean {
  return (evidence.trace.toolCalls ?? []).some(
    (call) => call.server === 'notion' && call.ok && LOOKUP_TOOLS.has(call.tool),
  );
}

/**
 * How a comment refers to the promise: by the client or by the substance (proposal). The attempt
 * tag in the client's name is unique, but the model does not have to copy it, because the Skill
 * says to write without technical marks. A comment that says “клієнту Lotus” (to the client
 * Lotus) refers to the promise just the same.
 */
const PROMISE_MARKERS: readonly string[] = [CLIENT_STEM, 'пропозиці', 'proposal', 'комерцій'];

/**
 * Builds the claim for a conversation about a promise: the person in a thread on a page says they
 * promised someone. A label is raised, the system makes one comment in this thread and the comment
 * refers to the promise, and no new pages appear. `notified` means the person replied from the
 * channel, so the question to them arrives as a notification, because a Notion comment does not
 * reach the channel.
 */
function commitmentClaim(evidence: Evidence6, notified: boolean): Claim {
  const said = inThread(evidence, 'prices');

  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'prices']),
    noNewPages(evidence),
    atMostOneNotification(evidence),
    recognition(
      'positive',
      ...(notified ? [observed('the person is notified', 1, deliveries(evidence))] : []),
      holds('an untracked commitment is raised', raised(evidence, 'untracked_commitment')),
      observed('one comment in the thread of the reply', 1, said.length),
      holds('the comment names the promise', mentionsAny(wordsOfThe(said), PROMISE_MARKERS)),
    ),
  );
}

/**
 * Builds the claim for the same conversation when an equivalent Task already sits in another
 * Project, so nothing new is raised.
 */
function trackedCommitmentClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'sales', 'prices', 'equivalent']),
    noNewPages(evidence),
    atMostOneNotification(evidence),
    recognition(
      'negative',
      holds('no untracked commitment is raised', !raised(evidence, 'untracked_commitment')),
    ),
    recognition(
      'positive',
      holds('the run looked for an equivalent task', lookedForEquivalent(evidence)),
    ),
  );
}

/** The person speaks of an intent. That is not a promise, so there is no label. */
function notPromiseClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'prices']),
    noNewPages(evidence),
    atMostOneNotification(evidence),
    recognition(
      'negative',
      holds('no untracked commitment is raised', !raised(evidence, 'untracked_commitment')),
    ),
  );
}

/**
 * A third party made the promise. The norm has not yet decided whether to raise a label on it
 * (`unclarified_input` and someone else's promise are open policy questions), so there is no
 * expectation here: the gate records what the run did (labels, texts, notifications, in the
 * artifacts) and checks only what every scenario shares.
 */
function thirdPartyClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'prices']),
    noNewPages(evidence),
    atMostOneNotification(evidence),
  );
}

/**
 * Builds the claim for a Task that waits for an external reply, has no other path and has a close
 * deadline. The dependency and the deadline risk are named on the Task, there is one comment, a
 * continuation and at most one notification, and the Project stays intact.
 */
function dependencyStepClaim(evidence: Evidence6): Claim {
  const onTask = commentsOn(evidence, 'waiting');

  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting']),
    followUpLead(evidence),
    atMostOneNotification(evidence),
    effect(holds('at most one comment on any page', evidence.written.comments.length <= 1)),
    recognition(
      'positive',
      holds(
        'the dependency rests on the Task the run read',
        detectionsOf(evidence, 'dependency').some((item) =>
          citedBy(item, evidence, 'waiting', 'notion'),
        ),
      ),
      holds('the deadline risk is raised', raised(evidence, 'deadline_risk')),
      holds('the run cites the Project it read', cites(evidence, 'project', 'notion')),
      holds('the Task is spoken to', onTask.length >= 1),
      holds('a follow-up is set', evidence.continuations.length >= 1),
      holds('the person is notified', deliveries(evidence) >= 1),
    ),
    recognition(
      'negative',
      holds('no project integrity is raised', !raised(evidence, 'project_integrity')),
      observed('nothing is said on the Project', [], wordsOfThe(commentsOn(evidence, 'project'))),
    ),
  );
}

/**
 * Builds the claim for the same event a second time, with a new id. The situation is the same, so
 * the person is not written to a second time. Together with the first step there is at most one
 * comment and one notification on any pages. The measure is the sum of the two steps, not the
 * silence of the second step, because the first might have said nothing (a check failure, a
 * comment that did not land), and then the second step's comment is the first comment, not a
 * second one.
 */
function repeatedEventClaim(evidence: Evidence6, first: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting']),
    effect(
      holds(
        'together with the first run, at most one comment on any page',
        first.written.comments.length + evidence.written.comments.length <= 1,
      ),
      holds(
        'together with the first run, at most one notification',
        deliveries(first) + deliveries(evidence) <= 1,
      ),
    ),
  );
}

/**
 * Builds the claim for a recheck with the deadline moved. The situation got worse, so the risk is
 * named or the person is notified; there is at most one notification, and the statuses are
 * unchanged.
 */
function worsenedRecheckClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting']),
    followUpLead(evidence),
    atMostOneNotification(evidence),
    recognition(
      'positive',
      holds(
        'the deadline risk is raised or the person is notified',
        raised(evidence, 'deadline_risk') || deliveries(evidence) >= 1,
      ),
    ),
  );
}

/**
 * Builds the claim for the W1 chain: an event, a repeat and a recheck, each step under its own
 * name. There is no recheck when the first step set no continuation, because there is nothing for
 * a recheck to wake. This shows from the first step (“a follow-up is set”), not from the absence
 * of the second step.
 */
export function dependencyChainClaim(
  detection: Evidence6,
  repeated: Evidence6,
  recheck: Evidence6 | null,
): Claim {
  const done = [
    ['W1', dependencyStepClaim(detection)],
    ['R1', repeatedEventClaim(repeated, detection)],
  ] as const;

  return recheck === null ? steps(...done) : steps(...done, ['R2', worsenedRecheckClaim(recheck)]);
}

/** Builds the claim for a close deadline with no execution risk: silence, no risk label. */
function freePathClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'target', 'free']),
    silent(evidence),
    recognition(
      'negative',
      holds('no deadline risk is raised', !raised(evidence, 'deadline_risk')),
    ),
  );
}

/** The last open Task of an active Project is done: the Project has nothing to move it forward. */
function lastTaskDoneClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'first', 'last']),
    atMostOneNotification(evidence),
    recognition(
      'positive',
      holds('the project integrity is raised', raised(evidence, 'project_integrity')),
      observed('one comment on the Project', 1, commentsOn(evidence, 'project').length),
    ),
  );
}

/** All open Tasks are waiting or scheduled: that is motion, not a flaw in Project integrity. */
function waitingProjectClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting', 'scheduled']),
    atMostOneNotification(evidence),
    effect(
      observed('nothing is said on the Project', [], wordsOfThe(commentsOn(evidence, 'project'))),
    ),
    recognition(
      'negative',
      holds('no project integrity is raised', !raised(evidence, 'project_integrity')),
    ),
  );
}

/**
 * Builds the claim for a `Next Action` with an open blocker: a contradiction cites both sides. A
 * proposal, if there is one, touches only the dependent Task, because the blocker is not the
 * Task's to decide.
 */
function blockedNextActionClaim(evidence: Evidence6): Claim {
  const contradictions = detectionsOf(evidence, 'contradiction');
  const dependent = pageIdOf(evidence, 'dependent');

  return claimOf(
    common(evidence),
    statuses(evidence, ['dependent', 'blocker']),
    atMostOneNotification(evidence),
    effect(
      holds('at most one comment on any page', evidence.written.comments.length <= 1),
      holds(
        'any proposal touches only the dependent Task',
        evidence.proposals.every((proposal) =>
          proposal.effects.every((item) => sameId(item.pageId, dependent)),
        ),
      ),
      holds(
        'every proposal is carried in the notification, decidable by its buttons',
        offeredProposals(evidence).every((offer) => offer.offered),
      ),
    ),
    recognition(
      'positive',
      holds('a contradiction is raised', contradictions.length > 0),
      holds(
        'one contradiction cites both the Task and its blocker',
        contradictions.some(
          (item) =>
            citedBy(item, evidence, 'dependent', 'notion') &&
            citedBy(item, evidence, 'blocker', 'notion'),
        ),
      ),
      holds('the Task is spoken to', commentsOn(evidence, 'dependent').length >= 1),
    ),
    recognition('negative', observed('nothing is remembered', [], evidence.gbrainWrites)),
  );
}

/**
 * Builds the claim for a GBrain lesson about this Project that changes the decision: one label
 * cites both the GBrain page and the Notion page (a lesson not bound to a Task asserts nothing),
 * and the code word reaches the person.
 */
function lessonAppliesClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting']),
    noDirectGbrainWrites(evidence),
    atMostOneNotification(evidence),
    recognition(
      'positive',
      holds('the forgotten context is raised', raised(evidence, 'forgotten_context')),
      holds(
        'one detection cites both the lesson page of GBrain and a page of Notion',
        detectionsOf(evidence, 'forgotten_context').some(
          (item) =>
            citedBy(item, evidence, 'project', 'gbrain') &&
            (citedBy(item, evidence, 'waiting', 'notion') ||
              citedBy(item, evidence, 'project', 'notion')),
        ),
      ),
      holds(
        'the lesson reaches the person: its code word is in the text',
        mentionsAny(textsOf(evidence), [CODEWORD_STEM]),
      ),
    ),
    recognition('negative', observed('nothing is remembered', [], evidence.gbrainWrites)),
  );
}

/**
 * The lesson is on a page of another Project on the same topic, not this one, so there is no label
 * and no text from it. The run must look into GBrain. Otherwise the trap did not take effect, and
 * the fact that the run did not raise the label says nothing.
 */
function lessonElsewhereClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting']),
    noDirectGbrainWrites(evidence),
    atMostOneNotification(evidence),
    recognition(
      'positive',
      holds('the run looked into GBrain, where the trap lies', readGbrain(evidence)),
    ),
    recognition(
      'negative',
      holds('no forgotten context is raised', !raised(evidence, 'forgotten_context')),
      holds(
        'the lesson of the other project does not reach the person',
        !mentionsAny(textsOf(evidence), [CODEWORD_STEM]),
      ),
    ),
  );
}

/**
 * Builds the claim for one missed repetition: the friction and Area of Focus risk labels are not
 * raised, nothing is said on the Behavior System, there is at most one comment on the instance,
 * and there is no notification and no proposals. The gate does not know whether that comment is
 * neutral and contains no conclusion about the person: that is the mark of diagnostic words in
 * the verdict and the reading of the text by a person (`SCEN-19-45`, criterion 2).
 */
function behaviorMissClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    perimeter(untouched(evidence, 'system')),
    statuses(evidence, ['instance']),
    effect(
      observed(
        'nothing is said on the Behavior System',
        [],
        wordsOfThe(commentsOn(evidence, 'system')),
      ),
      holds('at most one comment on the instance', commentsOn(evidence, 'instance').length <= 1),
      observed('no proposal', [], evidence.proposals),
      observed('no notification', 0, deliveries(evidence)),
    ),
    recognition(
      'negative',
      holds(
        'no friction or Area of Focus risk label is raised',
        detectionTypes(evidence).every(
          (type) => type !== 'behavior_system_friction' && type !== 'area_of_focus_risk',
        ),
      ),
      observed('nothing is remembered', [], evidence.gbrainWrites),
    ),
  );
}

/**
 * Builds the claim for an `Advance` Area of Focus where nothing moves: a review-level ground,
 * silence in an event run.
 */
function areaOfFocusQuietClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    perimeter(untouched(evidence, 'area_of_focus')),
    statuses(evidence, ['finished', 'maybe']),
    silent(evidence),
    recognition(
      'negative',
      holds('no Area of Focus risk is raised', !raised(evidence, 'area_of_focus_risk')),
    ),
  );
}

/** An opportunity without the person's words is shadow: silence, no label. */
function opportunityQuietClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['event']),
    silent(evidence),
    recognition('negative', holds('no opportunity is raised', !raised(evidence, 'opportunity'))),
  );
}

/**
 * Builds the claim for an everyday edit in a Project of twelve Tasks: silence, no label and no
 * continuation.
 */
function quietEditClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'moved', 'waiting']),
    silent(evidence),
    recognition(
      'negative',
      holds('no label is raised', detectionTypes(evidence).length === 0),
      holds('no follow-up is set', evidence.continuations.length === 0),
    ),
  );
}

/**
 * The deadline has passed and the Project has other open Tasks: the risk is named and the Task is
 * spoken to.
 */
function deadlinePassedClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'late', 'other']),
    atMostOneNotification(evidence),
    recognition(
      'positive',
      holds('the deadline risk is raised', raised(evidence, 'deadline_risk')),
      holds('the Task is spoken to', commentsOn(evidence, 'late').length >= 1),
    ),
  );
}

/** A `Scheduled` Task whose date is earlier than the deadline is a planned path. */
function scheduledPathClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'planned']),
    atMostOneNotification(evidence),
    recognition(
      'negative',
      holds('no deadline risk is raised', !raised(evidence, 'deadline_risk')),
    ),
  );
}

/** `Planning` with an executable clarifying Task is healthy. */
function planningClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'clarify']),
    effect(
      observed('nothing is said on the Project', [], wordsOfThe(commentsOn(evidence, 'project'))),
    ),
    recognition(
      'negative',
      holds('no project integrity is raised', !raised(evidence, 'project_integrity')),
    ),
  );
}

/** An alternative among twelve Tasks is found: no deadline risk. */
function largeProjectClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting', 'alternative']),
    atMostOneNotification(evidence),
    recognition(
      'negative',
      holds('no deadline risk is raised', !raised(evidence, 'deadline_risk')),
    ),
  );
}

export const SINGLE_CLAIMS: Readonly<Partial<Record<ScenarioId, SingleClaim>>> = {
  ...M7_CLAIMS,
  U1_commitment: (evidence) => commitmentClaim(evidence, false),
  U2_commitment_tracked: trackedCommitmentClaim,
  U3_commitment_undated: (evidence) => commitmentClaim(evidence, true),
  U4_commitment_intent: notPromiseClaim,
  U5_commitment_third_party: thirdPartyClaim,
  E1_commitment_english: (evidence) => commitmentClaim(evidence, false),
  N1_free_path: freePathClaim,
  P1_last_task_done: lastTaskDoneClaim,
  P3_waiting_project: waitingProjectClaim,
  K1_blocked_next_action: blockedNextActionClaim,
  F1_lesson_applies: lessonAppliesClaim,
  F2_lesson_elsewhere: lessonElsewhereClaim,
  B1_behavior_miss: behaviorMissClaim,
  A1_area_of_focus_quiet: areaOfFocusQuietClaim,
  X1_opportunity_quiet: opportunityQuietClaim,
  Q1_quiet_edit: quietEditClaim,
  N2_deadline_passed: deadlinePassedClaim,
  N3_scheduled_path: scheduledPathClaim,
  P2_planning_clarifying: planningClaim,
  L1_large_project: largeProjectClaim,
};

/** The details of a detection for a person to read: everything the model said about its label. */
const detectionSchema = z.looseObject({
  type: z.string(),
  claim: z.string().optional(),
  why_now: z.string().optional(),
  evidence: z.array(z.looseObject({ server: z.string(), ref: z.string() })).optional(),
  counterevidence_checked: z.array(z.string()).optional(),
  uncertainties: z.array(z.string()).optional(),
});

const detailedSchema = z.looseObject({ detections: z.array(detectionSchema) });

/** What the run left for reading: everything the operator uses to judge quality, not presence. */
export interface Artifact {
  readonly step: string;
  readonly run: string;
  readonly status: string;
  readonly reason: string | null;
  readonly model: string | null;
  readonly turns: number | null;
  readonly durationMs: number | null;
  /** Calls by server, `Read` separately; StructuredOutput rejections and failed Notion calls. */
  readonly calls: Readonly<Record<string, number>>;
  readonly rejectedResults: number;
  readonly failedNotionCalls: number;
  /** Notion calls that spend the workspace query allowance, and how many of them Notion refused. */
  readonly metered: number;
  readonly refusedQueries: number;
  /**
   * The length of each notification packet of the run as the channel will render it, in characters
   * (the unit of the message limit), so it shows the margin before the limit.
   */
  readonly packetLengths: readonly number[];
  /**
   * The Skill files the run opened, in order, relative to the plugin directory (a rejected read
   * gets the suffix ` [failed]`). They show whether the agent reached an “as needed” file when the
   * rule lived in it.
   */
  readonly skillReads: readonly string[];
  /** What the CLI rejected the result with, per the schema (same texts as in the runner log). */
  readonly rejections: readonly string[];
  /**
   * GBrain calls in order with the model's arguments, long texts clipped. They show what the run
   * searched with and what it wrote, and the run trace does not keep arguments (`GAP-07`).
   */
  readonly gbrainCalls: readonly GbrainCall[];
  /**
   * App and perimeter refusals of the model's attempts (a second comment, a follow-up that is too
   * early). Without them, a disciplined model and one that kept running into the limits look the
   * same.
   */
  readonly refusals: readonly string[];
  readonly comments: readonly {
    readonly page: string;
    readonly thread: string;
    readonly text: string;
  }[];
  readonly notices: readonly Notice[];
  /** Proposals: the status and each effect as `<world page>.<property> = <value>`. */
  readonly proposals: readonly { readonly status: string; readonly effects: readonly string[] }[];
  readonly followUps: readonly { readonly reasonCode: string; readonly runAt: string }[];
  readonly detections: z.infer<typeof detectionSchema>[];
  readonly gbrainWrites: readonly string[];
  /** Writes outside the world's pages: foreign data the gate did not create and does not delete. */
  readonly foreign: readonly string[];
  /** Diagnostic words in the run's texts: not a verdict but what a person reads. */
  readonly flags: readonly string[];
}

/** How many characters of an argument's text stay in the artifact: the rest is read from GBrain. */
const ARGUMENT_EXCERPT = 300;

/** Clips the long texts in call arguments at every level. */
const clipped = (input: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  mapStrings(input, (text) => text.slice(0, ARGUMENT_EXCERPT));

function callsOf(trace: TraceView): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const call of trace.toolCalls ?? []) {
    const name = call.server ?? call.tool;

    counts[name] = (counts[name] ?? 0) + 1;
  }

  return counts;
}

/**
 * Builds an artifact from the run trace alone. A run that did not reach a conclusion (deferred,
 * unfinished, deadline, infrastructure failure) yields no evidence, but it had a cost and took
 * time. Without its artifact, a slow Skill that keeps runs going until the deadline would look
 * efficient, because infrastructure failures would drop out of efficiency.
 */
export function artifactOfTrace(
  step: string,
  trace: TraceView,
  seen: AttemptView = NOT_OBSERVED,
  reads: readonly NotionRead[] = [],
): Artifact {
  const calls = trace.toolCalls ?? [];
  const detailed = detailedSchema.safeParse(trace.result);

  return {
    step,
    run: trace.id,
    status: trace.status,
    reason: trace.reason,
    model: trace.model,
    turns: trace.numTurns,
    durationMs: trace.durationMs,
    calls: callsOf(trace),
    rejectedResults: calls.filter((call) => HARNESS_TOOLS.includes(call.tool) && !call.ok).length,
    failedNotionCalls: calls.filter((call) => call.server === 'notion' && !call.ok).length,
    metered: reads.filter((read) => read.metered).length,
    refusedQueries: reads.filter((read) => read.refused).length,
    packetLengths: [],
    skillReads: seen.skillReads,
    rejections: seen.rejections,
    gbrainCalls: seen.gbrainCalls.map((call) => ({ ...call, input: clipped(call.input) })),
    refusals: (trace.policyDecisions ?? []).map(
      (decision) =>
        `${decision.source}: ${decision.tool}${decision.reason === undefined ? '' : ` — ${decision.reason}`}`,
    ),
    comments: [],
    notices: [],
    proposals: [],
    followUps: [],
    detections: detailed.success ? detailed.data.detections : [],
    gbrainWrites: [],
    foreign: [],
    flags: [],
  };
}

/**
 * Returns the key of the world page holding the comment; a page outside the world is named by its
 * id.
 */
function pageKeyOf(evidence: Evidence6, pageId: string): string {
  const key = Object.keys(evidence.after).find((candidate) =>
    sameId(pageId, pageIdOf(evidence, candidate)),
  );

  return key ?? pageId;
}

/**
 * Builds the artifacts of one run, before cleanup, while the pages, threads and queue rows exist.
 */
export function artifactOf(evidence: Evidence6): Artifact {
  return {
    ...artifactOfTrace(evidence.step, evidence.trace, evidence.observed, evidence.reads),
    comments: evidence.written.comments.map((comment) => ({
      page: pageKeyOf(evidence, comment.pageId),
      thread: comment.discussionId,
      text: comment.text,
    })),
    notices: evidence.written.notices,
    packetLengths: evidence.written.packetLengths,
    proposals: evidence.proposals.map((proposal) => ({
      status: proposal.status,
      effects: proposal.effects.map(
        (item) => `${pageKeyOf(evidence, item.pageId)}.${item.propertyId} = ${item.value}`,
      ),
    })),
    followUps: evidence.continuations,
    gbrainWrites: evidence.gbrainWrites,
    foreign: evidence.foreign,
    flags: diagnosisIn(textsOf(evidence)),
  };
}
