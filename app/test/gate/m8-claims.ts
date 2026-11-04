import { DETECTOR_ACTIVATION, DETECTOR_LABELS } from '../../src/claude/result/detector-labels';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import type { ReviewMode } from '../../src/runs/trigger-envelope';
import {
  atMostOneNotification,
  common,
  followUpLead,
  identifiersIn,
  labelNamesIn,
} from './claim-parts';
import {
  dataSourceOf,
  deliveries,
  detectionsOf,
  detectionTypes,
  effect,
  engaged,
  holds,
  kinds,
  memoryWritesOf,
  observed,
  pageIdOf,
  perimeter,
  recognition,
  sameId,
  statusesUnchanged,
  type Claim,
  type Observation,
} from './gate-claims';
import { commentsOn, textsOf } from './m6-evidence';
import type {
  DeliveredPacket,
  Evidence8,
  OpenedThread,
  ReconcileTick,
  ThreadMemory,
  WindowView,
  Woken,
} from './m8-evidence';
import { FIXTURE_STEMS } from './m8-fixtures';
import { D1_STEMS, S1_KEY_RESULTS, S1_STEMS, S2_STEMS, W1_STEMS, X1_STEMS } from './m8-scenarios';
import type { IntakeView } from './scenario-world';

/**
 * Claims of gate M8: what the evidence of each scenario must show (`m8-scenarios.ts`). They judge
 * only what can be checked: labels with their evidence, packet fields, comments, proposals, pages
 * read, queue rows and the reconciliation memory. An object in a text is recognized by the Latin
 * stem of its name.
 */

/** Builds a claim from observations and from steps nobody was there to conduct. */
function claimWith(
  observations: readonly Observation[],
  unobserved: readonly string[] = [],
): Claim {
  if (observations.length === 0) throw new Error('a claim with no observation proves nothing');

  return { ok: observations.every((item) => item.ok), observations, unobserved };
}

/** Collects the words of a run's packets that the person reads: fields and proposal lines. */
function packetWords(evidence: Evidence8): string[] {
  return evidence.packets.flatMap(({ notice }) => [
    notice.noticed,
    notice.whyItMatters,
    notice.ask,
    ...(notice.context === undefined ? [] : [notice.context]),
    ...(notice.prepared === undefined ? [] : [notice.prepared]),
    ...(notice.proposals ?? []).map((proposal) => proposal.line),
  ]);
}

/**
 * Collects the words of the packet's findings, without the proposal lines. A proposal line names
 * its page, so the candidate it sits on is always named in the packet, even if there were no
 * Available Now.
 */
function findingWords(evidence: Evidence8): string[] {
  return evidence.packets.flatMap(({ notice }) => [
    notice.noticed,
    notice.whyItMatters,
    notice.ask,
    ...(notice.context === undefined ? [] : [notice.context]),
    ...(notice.prepared === undefined ? [] : [notice.prepared]),
  ]);
}

/** Checks whether a text names an object by the stem of its name. */
const names = (texts: readonly string[], stem: string): boolean =>
  texts.some((text) => text.toLowerCase().includes(stem.toLowerCase()));

/** Selects the stems that the texts name. */
const namedOf = (texts: readonly string[], stems: readonly string[]): string[] =>
  stems.filter((stem) => names(texts, stem));

/** Collects everything the run said to the person: packets and comments. */
const saidBy = (evidence: Evidence8): string[] => [
  ...packetWords(evidence),
  ...evidence.written.comments.map((comment) => comment.text),
];

/**
 * What the run loaded: the pages returned by queries or fetches, and the databases whose answers
 * are not parsed (`null` means one of those answers does not say which database it queried).
 */
interface Loaded {
  readonly pages: ReadonlySet<string>;
  readonly unparsedIn: ReadonlySet<string> | null;
}

function loadedOf(evidence: Evidence8): Loaded {
  const unparsed = evidence.reads.filter((read) => read.pages === null);

  return {
    pages: new Set(evidence.reads.flatMap((read) => read.pages ?? []).map(canonicalNotionId)),
    unparsedIn: unparsed.some((read) => read.dataSources === null)
      ? null
      : new Set(unparsed.flatMap((read) => read.dataSources ?? []).map(canonicalNotionId)),
  };
}

/**
 * Collects the pages the run opened (`notion-fetch`). That is how it reads a page body, not a query
 * row.
 */
function openedOf(evidence: Evidence8): ReadonlySet<string> {
  return new Set(
    evidence.reads
      .filter((read) => read.tool === 'notion-fetch')
      .flatMap((read) => read.pages ?? [])
      .map(canonicalNotionId),
  );
}

/**
 * Returns the keys of the world's pages the run loaded. `null` means an answer that is not parsed
 * could have returned one of them: a query to its database or to a database the call did not name.
 * A query to another database does not return the page, so an unparsed answer from the Inbox does
 * not make it unknown whether the Tasks were loaded.
 */
function loadedKeys(evidence: Evidence8, keys: readonly string[], loaded: Loaded): string[] | null {
  const pageOf = (key: string): string => canonicalNotionId(pageIdOf(evidence, key));
  const found = keys.filter((key) => loaded.pages.has(pageOf(key)));

  if (loaded.unparsedIn?.size === 0) return found;

  const { unparsedIn } = loaded;
  const unsure = keys.some((key) => {
    const source = dataSourceOf(evidence, key);

    return (
      !loaded.pages.has(pageOf(key)) &&
      (unparsedIn === null || source === null || unparsedIn.has(source))
    );
  });

  return unsure ? null : found;
}

/** Checks whether a label cites at least one of these pages as evidence. */
const citesOneOf = (
  detection: ReturnType<typeof detectionsOf>[number],
  pageIds: readonly string[],
): boolean => detection.evidence.some((item) => pageIds.some((id) => sameId(item.ref, id)));

/** Checks whether a label of this type has evidence on one of the pages. */
function raisedOn(evidence: Evidence8, type: string, pageIds: readonly string[]): boolean {
  return detectionsOf(evidence, type).some((detection) => citesOneOf(detection, pageIds));
}

const pagesOf = (evidence: Evidence8, keys: readonly string[]): string[] =>
  keys.map((key) => pageIdOf(evidence, key));

/** Labels in `shadow` mode: a run raises none of them in any review. */
const SHADOW_LABELS: readonly string[] = DETECTOR_LABELS.filter(
  (label) => DETECTOR_ACTIVATION[label] === 'shadow',
);

/** Reviews without comments: they show and suggest, but raise no labels. */
const SILENT_REVIEWS: readonly ReviewMode[] = ['daily_control', 'deep_review'];

/**
 * Builds the observations common to every review: a valid result over the Notion content, writes
 * only on pages of the world and seeded pages, no ids or label names in the texts for the person,
 * no `shadow` label raised, and no labels at all from a review without comments.
 */
function commonOfReview(evidence: Evidence8, mode: ReviewMode): Observation[] {
  const texts = textsOf(evidence);

  return [
    ...effect(
      ...engaged(evidence),
      observed('every write of the run lies on a page of the world', [], evidence.foreign),
      observed('no identifier in any text for the person', [], identifiersIn(texts)),
      observed('no label name in any text for the person', [], labelNamesIn(texts)),
      ...(SILENT_REVIEWS.includes(mode)
        ? [observed('a review without comments raises no label', [], detectionTypes(evidence))]
        : []),
    ),
    ...recognition(
      'negative',
      observed(
        'no shadow label is raised',
        [],
        detectionTypes(evidence).filter((type) => SHADOW_LABELS.includes(type)),
      ),
    ),
  ];
}

/**
 * Observes what the tool set of every review enforces: Notion is only read, and there is one
 * packet.
 */
function reviewPerimeter(evidence: Evidence8): Observation[] {
  return [
    ...perimeter(...statusesUnchanged(evidence, Object.keys(evidence.after))),
    ...atMostOneNotification(evidence),
    ...perimeter(
      observed(
        'no Task or Project is created',
        [],
        kinds(evidence).filter((kind) => kind === 'page_created'),
      ),
      holds(
        'every proposal of the packet has its own row of buttons, numbered when there are several',
        evidence.packets.every(buttonsFit),
      ),
    ),
  ];
}

/**
 * Checks whether the packet's buttons are a row of “approve”/“reject” per proposal, numbered when
 * there are several.
 */
function buttonsFit(packet: DeliveredPacket): boolean {
  const proposals = packet.notice.proposals ?? [];

  return (
    packet.buttons.length === proposals.length &&
    packet.buttons.every(
      (row, index) =>
        row.length === 2 &&
        (proposals.length < 2 || row.every((label) => label.startsWith(`${index + 1} `))),
    )
  );
}

const queued = (evidence: Evidence8): Observation =>
  holds('the review queues its packet', evidence.packets.length === 1);

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------

/** Checks whether a `noticed` line about the Inbox contains the number of stale items. */
function countsStale(evidence: Evidence8, count: number): boolean {
  const words = count === 2 ? ['2', 'два', 'дві', 'двоє'] : [String(count)];
  const number = new RegExp(`(^|[^\\p{L}\\p{N}])(${words.join('|')})([^\\p{L}\\p{N}]|$)`, 'iu');

  return evidence.packets.some(({ notice }) =>
    notice.noticed.split('\n').some((line) => /inbox|вхідн/i.test(line) && number.test(line)),
  );
}

export function dailyClaim(evidence: Evidence8, proposal: string): Claim {
  const stems = D1_STEMS;
  const said = packetWords(evidence);
  const loaded = loadedOf(evidence);
  const backlog = [...stems.done, ...stems.someday].map((stem) => stem.toLowerCase());
  const eligible = namedOf(findingWords(evidence), stems.eligible);
  const backlogLoaded = loadedKeys(evidence, backlog, loaded);
  const identityLoaded = loadedKeys(evidence, ['founder'], loaded);
  const reads = effect(
    ...(backlogLoaded === null
      ? []
      : [observed('no Done or Someday/Maybe task of the world is loaded', [], backlogLoaded)]),
    ...(identityLoaded === null ? [] : [observed('no Identity is loaded', [], identityLoaded)]),
  );

  return claimWith(
    [
      ...reviewPerimeter(evidence),
      ...perimeter(
        observed(
          'no comment is written',
          [],
          kinds(evidence).filter((kind) => kind === 'comment'),
        ),
        observed(
          'no proposal is made',
          [],
          kinds(evidence).filter((kind) => kind === 'proposal'),
        ),
        observed(
          'no GBrain call is made',
          [],
          (evidence.trace.toolCalls ?? [])
            .filter((call) => call.server === 'gbrain')
            .map((call) => call.tool),
        ),
      ),
      ...effect(
        queued(evidence),
        holds(
          'the packet carries the proposal that waits',
          evidence.packets.some(({ notice }) =>
            (notice.proposals ?? []).some((item) => sameId(item.pendingActionId, proposal)),
          ),
        ),
        observed('the packet names no Someday/Maybe task', [], namedOf(said, stems.someday)),
        observed(
          'the packet names no undated task of the paused project',
          [],
          namedOf(said, stems.pausedOpen),
        ),
        observed(
          'the packet gives the stale Inbox items only as a number',
          [],
          namedOf(said, Object.values(FIXTURE_STEMS)),
        ),
      ),
      ...reads,
      ...commonOfReview(evidence, 'daily_control'),
      ...recognition(
        'positive',
        holds('the packet names the deadline of today', names(said, stems.deadlineToday)),
        holds('the packet names the time-fixed call of tomorrow', names(said, stems.timedTomorrow)),
        holds('the packet names what is scheduled for today', names(said, stems.scheduledToday)),
        holds('the packet names the scheduled task whose date passed', names(said, stems.overdue)),
        holds(
          'the packet names the time-fixed commitment of the paused project',
          names(said, stems.pausedFixed),
        ),
        observed(
          'the Available Now offers some of the candidates, not all',
          true,
          eligible.length >= 1 && eligible.length < stems.eligible.length,
        ),
        holds('the packet counts two stale Inbox items in one line', countsStale(evidence, 2)),
      ),
    ],
    backlogLoaded === null || identityLoaded === null
      ? ['what the run loaded: a reply of Notion did not parse']
      : [],
  );
}

// ---------------------------------------------------------------------------
// W1
// ---------------------------------------------------------------------------

/** Pages of W1 on which a finding sits: a comment and a proposal are appropriate only here. */
const W1_FINDINGS: readonly string[] = [
  'waiting',
  'overdueDeadline',
  'stalled',
  'planning',
  'paused',
  'pausedFixed',
  'resolved',
  'behavior',
  'area',
];

export function weeklyClaim(evidence: Evidence8): Claim {
  const stems = W1_STEMS;
  const said = packetWords(evidence);
  const findings = new Set(
    [...pagesOf(evidence, W1_FINDINGS), evidence.fixtures.plain].map(canonicalNotionId),
  );
  const proposable = new Set(
    pagesOf(
      evidence,
      W1_FINDINGS.filter((key) => key !== 'waiting'),
    ).map(canonicalNotionId),
  );
  const commented = evidence.written.comments.map((comment) => canonicalNotionId(comment.pageId));
  const threads = new Set(
    evidence.written.comments.map((comment) => canonicalNotionId(comment.discussionId)),
  );
  const effects = evidence.proposals.flatMap((proposal) => proposal.effects);
  const plain = [evidence.fixtures.plain];

  return claimWith([
    ...reviewPerimeter(evidence),
    ...effect(
      queued(evidence),
      observed('the review opens at most two new threads', true, evidence.newThreads.length <= 2),
      observed(
        'comments lie only on pages with a finding',
        [],
        commented.filter((page) => !findings.has(page)),
      ),
      observed(
        'the Inbox item that waits for its answer gets no new comment',
        [],
        commented.filter((page) => sameId(page, evidence.fixtures.asked)),
      ),
      observed(
        'every proposal lies on a page with a finding, sets no Failed and leaves the Waiting For whose dependency is open',
        [],
        effects
          .filter(
            (item) => !proposable.has(canonicalNotionId(item.pageId)) || item.option === 'Failed',
          )
          .map((item) => `${item.pageId} = ${item.value}`),
      ),
      holds(
        'a packet whose run wrote comments attaches one of their threads',
        threads.size === 0 ||
          evidence.packets.every(
            (packet) => packet.discussionId !== null && threads.has(packet.discussionId),
          ),
      ),
    ),
    ...commonOfReview(evidence, 'weekly_control_review'),
    ...recognition(
      'positive',
      holds(
        'the stale Inbox item is raised as unclarified',
        raisedOn(evidence, 'unclarified_input', plain),
      ),
      holds(
        'the Waiting For whose check date passed is a dependency',
        raisedOn(evidence, 'dependency', pagesOf(evidence, ['waiting'])),
      ),
      holds(
        'the Active project with nothing in motion has its integrity raised',
        raisedOn(evidence, 'project_integrity', pagesOf(evidence, ['stalled'])),
      ),
      holds(
        'the Planning project with no open task has its integrity raised',
        raisedOn(evidence, 'project_integrity', pagesOf(evidence, ['planning'])),
      ),
      holds(
        'the paused project with a time-fixed task has its integrity raised',
        raisedOn(evidence, 'project_integrity', pagesOf(evidence, ['paused', 'pausedFixed'])),
      ),
      holds(
        'the behavior with friction is raised',
        raisedOn(evidence, 'behavior_system_friction', pagesOf(evidence, ['behavior'])),
      ),
      // The ground is the movement of the linked work, so the label cites the Tasks of the Area of
      // Focus too. A label on the Area of Focus alone could rest on `Standard`, which Notion does
      // not show.
      holds(
        'the Area of Focus under Advance with nothing in motion is raised on its Tasks',
        detectionsOf(evidence, 'area_of_focus_risk').some(
          (detection) =>
            citesOneOf(detection, pagesOf(evidence, ['area'])) &&
            citesOneOf(detection, pagesOf(evidence, ['strings', 'lessons'])),
        ),
      ),
      holds(
        'the Waiting For with its blocker done is a contradiction',
        raisedOn(evidence, 'contradiction', pagesOf(evidence, ['resolved'])),
      ),
      holds(
        'the Waiting For with its blocker done is proposed as Next Action',
        effects.some(
          (item) =>
            sameId(item.pageId, pageIdOf(evidence, 'resolved')) && item.option === 'Next Action',
        ),
      ),
      holds(
        'the packet names the Inbox item waiting for its answer',
        names(said, FIXTURE_STEMS.asked),
      ),
      holds('the packet names the coming Scheduled task', names(said, stems.upcoming)),
      holds('the packet names the Deadline that passed', names(said, stems.overdueDeadline)),
      // It is not visible whether the packet also names the `Next Action` of the paused Project,
      // because its stem is also in the name of the Project the packet reports as a finding.
      holds(
        'the packet names a Next Action of an Active project for the coming week',
        names(said, stems.nextAction) || names(said, stems.overdueDeadline),
      ),
    ),
    ...recognition(
      'negative',
      holds(
        'the quiet Area of Focus under Maintain is not raised',
        !raisedOn(evidence, 'area_of_focus_risk', pagesOf(evidence, ['quietArea'])),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// S1, S2
// ---------------------------------------------------------------------------

/** The work of each S1 Objective: the Projects and Tasks the conflict over evenings falls on. */
const COURSE_WORK: readonly string[] = ['recording', 'shoot', 'edit', 'publish'];
const RACE_WORK: readonly string[] = ['training', 'intervals', 'tempo', 'long'];

/** Key Results and the Objective the person said nothing about: no evidence change occurs there. */
const UNSPOKEN: readonly string[] = ['rating', 'race', 'distance'];

/**
 * Checks whether the run asks the person about an S1 Key Result. The run asks when it names the Key
 * Result where it asks, by the stem of its name, by its target or by what it measures. A question
 * that needs the person's words sits in a comment, and the `ask` of the packet says what to answer
 * (`reviewing.md`). `noticed` only says what the run saw. In a comment, what asks is a paragraph or
 * item that contains a question. A question also refers to what is named in it by a pronoun
 * (“What does it show currently?”), so the unit is the paragraph, not the sentence. In a paragraph
 * that asks about something else, `asksAbout` cannot tell a statement from a question. A paragraph
 * without a question asks nothing.
 */
function asksAbout(evidence: Evidence8, key: keyof typeof S1_KEY_RESULTS): boolean {
  const asked = [
    ...evidence.packets.map(({ notice }) => notice.ask),
    ...evidence.written.comments.flatMap((comment) =>
      comment.text.split(/\n+/).filter((paragraph) => paragraph.includes('?')),
    ),
  ];

  return (
    names(asked, S1_STEMS[key]) || asked.some((text) => S1_KEY_RESULTS[key].reference.test(text))
  );
}

export function strategicClaim(evidence: Evidence8): Claim {
  const stems = S1_STEMS;
  const said = saidBy(evidence);
  const evidenceChanges = detectionsOf(evidence, 'objective_evidence_change');
  const cites = (detection: (typeof evidenceChanges)[number], keys: readonly string[]): boolean =>
    detection.evidence.some((item) => pagesOf(evidence, keys).some((id) => sameId(item.ref, id)));
  const objectives = new Set(pagesOf(evidence, ['course', 'race']).map(canonicalNotionId));

  return claimWith([
    ...reviewPerimeter(evidence),
    ...perimeter(observed('no memory is written', [], memoryWritesOf(evidence.trace))),
    ...effect(
      queued(evidence),
      // The person's words are in the thread of the course. Evidence that does not cite it is a
      // finished Project or the run's own reading, which `detectors.md` does not allow. The person
      // said nothing about the other Key Results.
      observed(
        'the evidence of a Key Result is raised only for the first one, on the words of the person',
        [],
        evidenceChanges
          .filter((detection) => !cites(detection, ['course']) || cites(detection, UNSPOKEN))
          .map((detection) => detection.evidence.map((item) => item.ref).join(', ')),
      ),
      observed(
        'no proposal is made',
        [],
        kinds(evidence).filter((kind) => kind === 'proposal'),
      ),
      observed(
        'comments lie only on Objectives',
        [],
        evidence.written.comments
          .map((comment) => canonicalNotionId(comment.pageId))
          .filter((page) => !objectives.has(page)),
      ),
      observed('the review opens at most two new threads', true, evidence.newThreads.length <= 2),
    ),
    ...commonOfReview(evidence, 'strategic_review'),
    ...recognition(
      'positive',
      holds(
        'the change the person stated in the first Key Result is raised',
        evidenceChanges.some((detection) => cites(detection, ['course'])),
      ),
      holds('the course Objective is reviewed', names(said, stems.course)),
      holds('the race Objective is reviewed', names(said, stems.race)),
      holds('the rating Key Result is asked about', asksAbout(evidence, 'rating')),
      holds('the distance Key Result is asked about', asksAbout(evidence, 'distance')),
      holds(
        'the conflict for the evenings cites the work of both Objectives',
        detectionsOf(evidence, 'resource_conflict').some(
          (detection) =>
            detection.evidence.some((item) =>
              pagesOf(evidence, COURSE_WORK).some((id) => sameId(item.ref, id)),
            ) &&
            detection.evidence.some((item) =>
              pagesOf(evidence, RACE_WORK).some((id) => sameId(item.ref, id)),
            ),
        ),
      ),
      holds('the Area of Focus and its Mode are named', names(said, stems.area)),
    ),
  ]);
}

export function lessonClaim(evidence: Evidence8): Claim {
  const said = saidBy(evidence);

  return claimWith([
    ...reviewPerimeter(evidence),
    ...perimeter(observed('no memory is written', [], memoryWritesOf(evidence.trace))),
    ...effect(queued(evidence)),
    ...commonOfReview(evidence, 'strategic_review'),
    ...recognition(
      'positive',
      holds(
        'the lesson candidate names both episodes',
        names(said, S2_STEMS.first) && names(said, S2_STEMS.second),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// DP1
// ---------------------------------------------------------------------------

export function deepClaim(evidence: Evidence8): Claim {
  const identity = canonicalNotionId(pageIdOf(evidence, 'identity'));

  return claimWith([
    ...reviewPerimeter(evidence),
    ...perimeter(
      observed(
        'no comment is written',
        [],
        kinds(evidence).filter((kind) => kind === 'comment'),
      ),
      observed(
        'no proposal is made',
        [],
        kinds(evidence).filter((kind) => kind === 'proposal'),
      ),
    ),
    ...effect(queued(evidence)),
    ...commonOfReview(evidence, 'deep_review'),
    ...recognition('positive', holds('the Identity is opened', openedOf(evidence).has(identity))),
  ]);
}

// ---------------------------------------------------------------------------
// SW1
// ---------------------------------------------------------------------------

/** Steps of SW1: a tick, a wake, a tick; `woken` is the id of the Task the first tick must wake. */
interface SweepSteps {
  readonly woken: string;
  readonly first: readonly Woken[];
  readonly run: Evidence8 | null;
  readonly second: readonly Woken[];
}

export function sweepClaim(steps: SweepSteps): Claim {
  const { run } = steps;
  const pages = (woken: readonly Woken[]): string[] => woken.map((item) => item.pageId).sort();

  return claimWith([
    ...perimeter(
      observed(
        'the first tick wakes exactly the task whose check date came and whose deadline nears',
        [canonicalNotionId(steps.woken)],
        pages(steps.first),
      ),
      observed('the second tick wakes nobody', [], pages(steps.second)),
    ),
    ...(run === null
      ? []
      : [
          ...perimeter(...statusesUnchanged(run, Object.keys(run.after))),
          ...followUpLead(run),
          ...atMostOneNotification(run),
          ...common(run),
          ...recognition(
            'positive',
            holds(
              'the woken task is a dependency',
              raisedOn(run, 'dependency', pagesOf(run, ['woken'])),
            ),
            holds(
              'the deadline of the woken task is at risk',
              raisedOn(run, 'deadline_risk', pagesOf(run, ['woken'])),
            ),
            holds('the woken task is spoken to', commentsOn(run, 'woken').length > 0),
            holds('the person is notified', deliveries(run) === 1),
          ),
        ]),
  ]);
}

// ---------------------------------------------------------------------------
// X1
// ---------------------------------------------------------------------------

/**
 * Steps of X1: a body and property edit of a Task, a control edit of an Area of Focus body, the
 * window and the run.
 */
interface BodySteps {
  readonly content: IntakeView;
  readonly properties: IntakeView;
  readonly control: IntakeView;
  readonly window: WindowView;
  readonly run: Evidence8;
}

export function bodyClaim(steps: BodySteps): Claim {
  const { run } = steps;
  const estimate = canonicalNotionId(pageIdOf(run, 'estimate'));

  return claimWith([
    ...perimeter(
      holds('the body edit of the Task opens a window', steps.content.windowed),
      holds('the property edit joins it', steps.properties.windowed),
      observed(
        'the window carries both kinds of change, the latest as its type',
        {
          eventTypes: ['page.content_updated', 'page.properties_updated'],
          type: 'page.properties_updated',
        },
        { eventTypes: [...steps.window.eventTypes].sort(), type: steps.window.type },
      ),
      holds(
        'the body edit of an Area of Focus is turned away with a reason',
        !steps.control.windowed && steps.control.reason !== null,
      ),
      ...statusesUnchanged(run, Object.keys(run.after)),
      observed(
        'no Task or Project is created',
        [],
        kinds(run).filter((kind) => kind === 'page_created'),
      ),
    ),
    ...common(run),
    ...effect(holds('the run opens the Task whose body changed', openedOf(run).has(estimate))),
    ...recognition(
      'positive',
      holds(
        'the promise in the body is an untracked commitment',
        raisedOn(run, 'untracked_commitment', pagesOf(run, ['estimate'])),
      ),
      holds(
        'a comment on the Task names the client',
        commentsOn(run, 'estimate').some((comment) => names([comment.text], X1_STEMS.client)),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// C1
// ---------------------------------------------------------------------------

/**
 * Steps of C1: three threads, a tick, resolution by the person, a tick, a tick. `resolved` says
 * whether the person resolved the thread. `null` means there was no operator (no `--manual`) or
 * the operator did not make it in time, so the step was not conducted.
 */
export interface ReconciliationSteps {
  readonly threads: Readonly<Record<'resolved' | 'open' | 'deleted', OpenedThread>>;
  readonly first: ReconcileTick;
  readonly resolved: true | null;
  readonly second: ReconcileTick;
  readonly third: ReconcileTick;
}

/**
 * Describes what the reconciliation remembers about a thread: whether it saw the thread open,
 * asked for its closure, found it gone. A thread with no memory was not judged by the
 * reconciliation at all.
 */
function stateOf(memory: ThreadMemory | undefined): unknown {
  if (memory === undefined) return 'not reconciled';

  return {
    open: memory.seenOpenAt !== null,
    closure: memory.closureRequestedAt !== null,
    gone: memory.goneAt !== null,
  };
}

export function reconciliationClaim(steps: ReconciliationSteps): Claim {
  const { threads, first, second, third } = steps;
  const id = (key: keyof ReconciliationSteps['threads']): string => threads[key].discussionId;
  const ours = new Set(Object.values(threads).map((thread) => thread.discussionId));
  const closures = (tick: ReconcileTick): string[] =>
    tick.closures.map((item) => item.discussionId).sort();
  const all = [first, second, third].flatMap((tick) => tick.closures);
  const resolvedSteps: Observation[] =
    steps.resolved !== null
      ? [
          observed(
            'after the person resolved one thread, exactly it is asked to close',
            [id('resolved')],
            closures(second),
          ),
          observed(
            'the resolved thread is remembered as asked to close',
            { open: true, closure: true, gone: false },
            stateOf(second.memory[id('resolved')]),
          ),
        ]
      : [
          observed(
            'without a resolved thread the second tick asks no closure',
            [],
            closures(second),
          ),
        ];

  return claimWith(
    [
      ...perimeter(
        observed('the first tick asks no closure', [], closures(first)),
        observed(
          'the first tick sees every thread of the scenario open',
          Object.values(threads)
            .map((thread) => thread.discussionId)
            .sort(),
          Object.values(threads)
            .map((thread) => thread.discussionId)
            .filter((thread) => first.memory[thread]?.seenOpenAt != null)
            .sort(),
        ),
        ...resolvedSteps,
        observed(
          'the open thread stays open with no closure',
          { open: true, closure: false, gone: false },
          stateOf(second.memory[id('open')]),
        ),
        holds(
          'the second tick sees the open thread again',
          (second.memory[id('open')]?.seenOpenAt ?? '') >
            (first.memory[id('open')]?.seenOpenAt ?? ''),
        ),
        observed(
          'the thread whose comment is gone is remembered gone, with no closure',
          { open: true, closure: false, gone: true },
          stateOf(second.memory[id('deleted')]),
        ),
        observed('the next tick asks nothing new', [], closures(third)),
        observed(
          'no closure is asked for a thread outside the scenario',
          [],
          all.map((item) => item.discussionId).filter((thread) => !ours.has(thread)),
        ),
      ),
    ],
    steps.resolved === null
      ? ['the person resolving a thread in Notion (run with --manual, resolve within the wait)']
      : [],
  );
}
