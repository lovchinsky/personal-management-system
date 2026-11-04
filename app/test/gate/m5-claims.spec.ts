import { Read } from '../../src/notion/semantics/reading';
import { AppliedEffect } from '../../src/runs/run-effects';
import { TraceView } from '../../src/runs/run-traces';
import { PROFILE_MODEL } from '../fixtures/claude-stream.fixture';
import { INTEGRATION_BOT } from '../fixtures/notion-bot';
import {
  Claim,
  Evidence,
  MEMORY_RECORD_TOOL,
  PageSnapshot,
  ProposalView,
  SeenComment,
} from './gate-claims';
import {
  alternativePathClaim,
  blockedFigureOf,
  closureDecisionClaim,
  contradictionClaim,
  dependencyRaisedClaim,
  DependencySlice,
  dependencySliceClaim,
  healthyAreaOfFocusClaim,
  identityClaim,
  pausedProjectClaim,
  terminalProjectClaim,
  terminalReplyClaim,
  UNOBSERVED_CLOSURE,
  unreadableEvidenceClaim,
} from './m5-claims';

const BOT = INTEGRATION_BOT;
const PERSON = 'person-1';
const STATUS = 'status-property';
const STARTED = new Date('2026-10-08T09:00:00Z');

/** A page identifier in the form Notion returns, with hyphens. */
const idOf = (key: string): string => `${key}-aaaa-bbbb`;

const page = (key: string, overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  id: idOf(key),
  name: `Сторінка ${key}`,
  status: null,
  mode: null,
  date: null,
  deadline: null,
  inTrash: false,
  comments: [],
  ...overrides,
});

const worldOf = (
  pages: Readonly<Record<string, Partial<PageSnapshot>>>,
): Record<string, PageSnapshot> =>
  Object.fromEntries(Object.entries(pages).map(([key, overrides]) => [key, page(key, overrides)]));

let commentNumber = 0;

/** A page comment: each has its own Notion id, even when the text is the same. */
const said = (text: string, author = BOT): SeenComment => {
  commentNumber += 1;

  return { id: `comment-${commentNumber}`, text, author };
};

const effects = (...kinds: AppliedEffect['kind'][]): AppliedEffect[] =>
  kinds.map((kind, index) => ({ kind, id: `${kind}-${index}` }));

const detection = (type: string, ...refs: readonly (readonly [string, string])[]): unknown => ({
  type,
  claim: 'Твердження',
  why_now: 'Тому що',
  evidence: refs.map(([server, ref]) => ({ server, ref })),
  counterevidence_checked: [],
  uncertainties: [],
});

const trace = (overrides: Partial<TraceView> = {}): TraceView => ({
  id: 'run-1',
  status: 'completed',
  origin: 'operator',
  budgetClass: 'exempt',
  createdAt: STARTED,
  finishedAt: new Date('2026-10-08T09:01:00Z'),
  latencyMs: 60_000,
  reason: null,
  deferredUntil: null,
  init: null,
  toolCalls: [{ server: 'notion', tool: 'notion-fetch', ok: true }],
  policyDecisions: [],
  model: PROFILE_MODEL,
  modelUsage: {},
  numTurns: 8,
  durationMs: 50_000,
  terminalReason: 'completed',
  result: { outcome: 'no_action', detections: [] },
  runtimeEffects: [],
  ...overrides,
});

const evidence = (overrides: Partial<Evidence> = {}): Evidence => ({
  step: 'run',
  trace: trace(),
  before: {},
  after: {},
  proposals: [],
  continuations: [],
  gbrainWrites: [],
  bot: BOT,
  statusProperty: STATUS,
  ...overrides,
});

/** A world that does not change during a run: before and after are identical. */
const still = (
  pages: Readonly<Record<string, Partial<PageSnapshot>>>,
): Pick<Evidence, 'before' | 'after'> => ({
  before: worldOf(pages),
  after: worldOf(pages),
});

/** The same world, but with the status of one page different. */
const withStatus = (world: Evidence['after'], key: string, status: string): Evidence['after'] => ({
  ...world,
  [key]: page(key, { ...world[key], status }),
});

/** A world in which the run added something: before, without comments; after, with them. */
const spoken = (
  pages: Readonly<Record<string, Partial<PageSnapshot>>>,
  comments: Readonly<Record<string, readonly string[]>>,
): Pick<Evidence, 'before' | 'after'> => ({
  before: worldOf(pages),
  after: worldOf(
    Object.fromEntries(
      Object.entries(pages).map(([key, overrides]) => [
        key,
        { ...overrides, comments: (comments[key] ?? []).map((text) => said(text)) },
      ]),
    ),
  ),
});

const proposal = (pageKey: string, option: string, id = `proposal-${pageKey}`): ProposalView => ({
  id,
  status: 'proposed',
  effects: [{ pageId: idOf(pageKey), propertyId: STATUS, option, value: option ?? '' }],
});

const REFS = {
  dependent: ['notion', idOf('dependent')] as const,
  blocker: ['notion', idOf('blocker')] as const,
  waiting: ['notion', idOf('waiting')] as const,
  project: ['notion', idOf('project')] as const,
  fixture: ['gbrain', `projects/${idOf('project').replaceAll('-', '')}`] as const,
};

/** S2 */
const ALTERNATIVE_WORLD = {
  project: { status: 'Active' },
  waiting: { status: 'Waiting For', name: 'Отримати схвалення макетів' },
  alternative: { status: 'Next Action' },
};
const ALTERNATIVE = evidence(still(ALTERNATIVE_WORLD));

/** S3 */
const PAUSED_WORLD = {
  project: { status: 'Paused' },
  plain: { status: 'Next Action', name: 'Порівняти ціни на вікна' },
  checking: { status: 'Waiting For', name: 'Дочекатися відповіді майстра' },
  committed: { status: 'Scheduled', name: 'Внести аванс бригаді' },
};
const COMMITTED = { commitments: ['Внести аванс бригаді'] };
const paused = (given: Evidence): Claim => pausedProjectClaim(given, COMMITTED);
const PAUSED = evidence({
  ...spoken(PAUSED_WORLD, {
    project: ['Проєкт на паузі, а «Внести аванс бригаді» має дедлайн: що з ним?'],
  }),
  trace: trace({
    runtimeEffects: effects('comment', 'delivery'),
    result: { outcome: 'attention_raised', detections: [detection('project_integrity')] },
  }),
});

/** S4 */
const TERMINAL_WORLD = {
  project: { status: 'Done' },
  next: { status: 'Next Action', name: 'Записатися на біометрію' },
  waiting: { status: 'Waiting For', name: 'Дочекатися листа з посольства' },
  someday: { status: 'Someday/Maybe', name: 'Подумати про річну візу' },
  finished: { status: 'Done', name: 'Подати анкету' },
};
const OBLIGATIONS = {
  obligationNames: [
    'Записатися на біометрію',
    'Дочекатися листа з посольства',
    'Подумати про річну візу',
  ],
  taskKeys: ['next', 'waiting', 'someday', 'finished'],
};
const TERMINAL = evidence({
  ...spoken(TERMINAL_WORLD, {
    project: [
      'Проєкт закрито, але лишилося: «Записатися на біометрію», «Дочекатися листа з посольства», «Подумати про річну візу». Що з ними?',
    ],
  }),
  trace: trace({
    runtimeEffects: effects('comment', 'delivery'),
    result: { outcome: 'attention_raised', detections: [detection('project_integrity')] },
  }),
});

const REPLY_OUTCOMES = { next: 'Done', waiting: 'Canceled' } as const;
const REPLY_UNTOUCHED = ['someday', 'finished'] as const;
const TERMINAL_REPLY = evidence({
  ...still(TERMINAL_WORLD),
  trace: trace({ runtimeEffects: effects('proposal', 'proposal') }),
  proposals: [proposal('next', 'Done'), proposal('waiting', 'Canceled')],
});

/** S5 */
const CONTRADICTION_WORLD = {
  project: { status: 'Active' },
  blocker: { status: 'Done' },
  dependent: { status: 'Waiting For' },
};
const CONTRADICTION = evidence({
  ...spoken(CONTRADICTION_WORLD, { dependent: ['Блокер уже виконано, а задача чекає на нього'] }),
  trace: trace({
    runtimeEffects: effects('comment'),
    result: {
      outcome: 'attention_raised',
      detections: [detection('contradiction', REFS.dependent, REFS.blocker)],
    },
  }),
});

/** S7, T2b, T2c */
const IDENTITY_WORLD = {
  identity: {},
  area_of_focus: { mode: 'Maintain' },
  failed: { status: 'Failed' },
};
const IDENTITY = evidence(still(IDENTITY_WORLD));
const AREA_OF_FOCUS = evidence(still({ area_of_focus: { mode: 'Maintain' } }));
const UNREADABLE = evidence(still({ objective: {}, result: {} }));

/** S1 */
const SLICE_WORLD = { project: { status: 'Active' }, waiting: { status: 'Waiting For' } };
const LEAD = new Date(STARTED.getTime() + 3 * 60 * 60 * 1000).toISOString();
const DETECTION = evidence({
  ...spoken(SLICE_WORLD, { waiting: ['Чекаємо на Legal; перевірю в день, коли настане дата'] }),
  trace: trace({
    runtimeEffects: effects('comment', 'continuation'),
    result: {
      outcome: 'attention_raised',
      detections: [detection('dependency', REFS.waiting, REFS.project, REFS.fixture)],
    },
  }),
  continuations: [{ reasonCode: 'await_external_event', runAt: LEAD }],
});

/** The same detection, but with other GBrain evidence in place of the gate's anchor page. */
const citing = (...refs: readonly (readonly [string, string])[]): Evidence => ({
  ...DETECTION,
  trace: trace({
    runtimeEffects: effects('comment', 'continuation'),
    result: {
      outcome: 'attention_raised',
      detections: [detection('dependency', REFS.waiting, REFS.project, ...refs)],
    },
  }),
});
const REPLY = evidence({
  ...still(SLICE_WORLD),
  trace: trace({ runtimeEffects: effects('comment', 'proposal') }),
  proposals: [proposal('waiting', 'Done')],
});
const RECHECK = evidence({
  ...still({ project: { status: 'Active' }, waiting: { status: 'Done' } }),
});
const CLOSURE = evidence({
  ...still({ project: { status: 'Active' }, waiting: { status: 'Done' } }),
  trace: trace({ result: { outcome: 'no_action', detections: [] } }),
});
const SLICE: DependencySlice = {
  detection: DETECTION,
  reply: REPLY,
  approval: { proposalStatus: 'executed', task: page('waiting', { status: 'Done' }), bot: BOT },
  recheck: RECHECK,
  closure: CLOSURE,
};

/** S6 */
const DECISION = evidence({
  ...still({ task: { status: 'Done' } }),
  trace: trace({ runtimeEffects: effects(), result: { outcome: 'fact_recorded', detections: [] } }),
  gbrainWrites: [MEMORY_RECORD_TOOL],
});

/** What each claim proves on evidence that looks as it should. */
const PROVEN: readonly [string, Claim][] = [
  ['S2 alternative path', alternativePathClaim(ALTERNATIVE)],
  ['S3 paused Project', pausedProjectClaim(PAUSED, COMMITTED)],
  ['S4 closed Project', terminalProjectClaim(TERMINAL, OBLIGATIONS)],
  [
    "S4 the person's reply",
    terminalReplyClaim(TERMINAL_REPLY, { outcomes: REPLY_OUTCOMES, untouched: REPLY_UNTOUCHED }),
  ],
  ['S5 structural contradiction', contradictionClaim(CONTRADICTION)],
  ['S7 Identity', identityClaim(IDENTITY)],
  ['T2b healthy Area of Focus', healthyAreaOfFocusClaim(AREA_OF_FOCUS)],
  ['T2c unreadable evidence', unreadableEvidenceClaim(UNREADABLE)],
  ['S1 dependency flow', dependencySliceClaim(SLICE)],
  ['S1 detection', dependencyRaisedClaim(DETECTION)],
  [
    'S1 flow citing the anchor in another form',
    dependencySliceClaim({
      ...SLICE,
      detection: citing([
        'gbrain',
        `gbrain://page/default/Projects/${idOf('project').replaceAll('-', '').toUpperCase()}.md`,
      ]),
    }),
  ],
  ['S1 flow without the closure step', dependencySliceClaim({ ...SLICE, closure: null })],
  ["S6 the person's decision", closureDecisionClaim(DECISION)],
];

/** A deviation from what is expected, and the claim it does not prove. */
const DEVIATIONS: readonly [string, Claim][] = [
  // S2
  [
    'S2: the dependency stopped waiting',
    alternativePathClaim({
      ...ALTERNATIVE,
      after: worldOf({ ...ALTERNATIVE_WORLD, waiting: { status: 'Next Action' } }),
    }),
  ],
  [
    'S2: the run proposed something',
    alternativePathClaim({ ...ALTERNATIVE, proposals: [proposal('waiting', 'Done')] }),
  ],
  [
    'S2: the Project got a comment about risk',
    alternativePathClaim({
      ...ALTERNATIVE,
      ...spoken(ALTERNATIVE_WORLD, { project: ['Проєкт під ризиком'] }),
    }),
  ],
  [
    'S2: a notification with no occasion',
    alternativePathClaim({ ...ALTERNATIVE, trace: trace({ runtimeEffects: effects('delivery') }) }),
  ],
  [
    'S2: a Project-level risk',
    alternativePathClaim({
      ...ALTERNATIVE,
      trace: trace({ result: { outcome: 'x', detections: [detection('project_integrity')] } }),
    }),
  ],
  [
    'S2: the run failed',
    alternativePathClaim({
      ...ALTERNATIVE,
      trace: trace({ status: 'failed', reason: 'api_error' }),
    }),
  ],

  // S3
  [
    'S3: the pause rewrote a Task status',
    paused({
      ...PAUSED,
      after: worldOf({ ...PAUSED_WORLD, committed: { status: 'Next Action' } }),
    }),
  ],
  [
    'S3: the run proposed something',
    paused({ ...PAUSED, proposals: [proposal('committed', 'Done')] }),
  ],
  [
    'S3: the pause is named a dependency',
    paused({
      ...PAUSED,
      trace: trace({
        runtimeEffects: effects('comment'),
        result: { outcome: 'x', detections: [detection('dependency')] },
      }),
    }),
  ],
  [
    'S3: the question is only about the check date, so the deadline is silently skipped',
    paused({
      ...PAUSED,
      ...spoken(PAUSED_WORLD, { project: ['Проєкт на паузі, а «Дочекатися відповіді майстра»?'] }),
    }),
  ],
  [
    'S3: the deadline is not named to the person',
    paused({ ...PAUSED, ...spoken(PAUSED_WORLD, { project: ['Проєкт на паузі'] }) }),
  ],
  ['S3: silence about the deadline', paused({ ...PAUSED, ...still(PAUSED_WORLD) })],

  // S4, first step
  [
    'S4: the comment skipped a Task',
    terminalProjectClaim(
      {
        ...TERMINAL,
        ...spoken(TERMINAL_WORLD, {
          project: ['Лишилося «Записатися на біометрію» і «Подумати про річну візу»'],
        }),
      },
      OBLIGATIONS,
    ),
  ],
  [
    'S4: two comments',
    terminalProjectClaim(
      {
        ...TERMINAL,
        ...spoken(TERMINAL_WORLD, {
          project: [...Array<string>(2).fill('Лишилося «Записатися на біометрію»')],
        }),
      },
      OBLIGATIONS,
    ),
  ],
  [
    'S4: a proposal before the person replies',
    terminalProjectClaim({ ...TERMINAL, proposals: [proposal('next', 'Canceled')] }, OBLIGATIONS),
  ],
  [
    'S4: the run declared a Task Failed',
    terminalProjectClaim(
      { ...TERMINAL, after: worldOf({ ...TERMINAL_WORLD, waiting: { status: 'Failed' } }) },
      OBLIGATIONS,
    ),
  ],
  [
    'S4: the Project is not named as project_integrity',
    terminalProjectClaim(
      { ...TERMINAL, trace: trace({ runtimeEffects: effects('comment') }) },
      OBLIGATIONS,
    ),
  ],

  // S4, the person's reply
  [
    'S4: a proposal on a done Task',
    terminalReplyClaim(
      {
        ...TERMINAL_REPLY,
        proposals: [...TERMINAL_REPLY.proposals, proposal('finished', 'Canceled')],
      },
      { outcomes: REPLY_OUTCOMES, untouched: REPLY_UNTOUCHED },
    ),
  ],
  [
    'S4: the person said “скасуй”, the system proposed Failed',
    terminalReplyClaim(
      { ...TERMINAL_REPLY, proposals: [proposal('next', 'Done'), proposal('waiting', 'Failed')] },
      { outcomes: REPLY_OUTCOMES, untouched: REPLY_UNTOUCHED },
    ),
  ],
  [
    'S4: one proposal for two Tasks',
    terminalReplyClaim(
      {
        ...TERMINAL_REPLY,
        proposals: [
          {
            id: 'both',
            status: 'proposed',
            effects: [
              { pageId: idOf('next'), propertyId: STATUS, option: 'Done', value: 'Done' },
              {
                pageId: idOf('waiting'),
                propertyId: STATUS,
                option: 'Canceled',
                value: 'Canceled',
              },
            ],
          },
        ],
      },
      { outcomes: REPLY_OUTCOMES, untouched: REPLY_UNTOUCHED },
    ),
  ],
  [
    "S4: the person's reply with no proposals",
    terminalReplyClaim(
      { ...TERMINAL_REPLY, proposals: [] },
      { outcomes: REPLY_OUTCOMES, untouched: REPLY_UNTOUCHED },
    ),
  ],

  // S5
  [
    'S5: no contradiction is named',
    contradictionClaim({ ...CONTRADICTION, trace: trace({ runtimeEffects: effects('comment') }) }),
  ],
  [
    'S5: evidence from one side only',
    contradictionClaim({
      ...CONTRADICTION,
      trace: trace({
        runtimeEffects: effects('comment'),
        result: { outcome: 'x', detections: [detection('contradiction', REFS.dependent)] },
      }),
    }),
  ],
  [
    'S5: the status is changed without the person',
    contradictionClaim({
      ...CONTRADICTION,
      after: worldOf({ ...CONTRADICTION_WORLD, dependent: { status: 'Next Action' } }),
    }),
  ],
  [
    'S5: a proposal on the blocker',
    contradictionClaim({ ...CONTRADICTION, proposals: [proposal('blocker', 'Canceled')] }),
  ],
  ['S5: a memory write', contradictionClaim({ ...CONTRADICTION, gbrainWrites: ['remember'] })],
  [
    'S5: nothing is said on the Task',
    contradictionClaim({ ...CONTRADICTION, ...still(CONTRADICTION_WORLD) }),
  ],

  // S7
  [
    'S7: the Identity got a comment',
    identityClaim({
      ...IDENTITY,
      ...spoken(IDENTITY_WORLD, { identity: ['Вам варто переглянути ваші принципи'] }),
    }),
  ],
  [
    'S7: the Area of Focus is changed',
    identityClaim({
      ...IDENTITY,
      after: worldOf({
        ...IDENTITY_WORLD,
        area_of_focus: { mode: 'Advance' },
      }),
    }),
  ],
  [
    'S7: a proposal',
    identityClaim({ ...IDENTITY, proposals: [proposal('area_of_focus', 'Done')] }),
  ],
  ['S7: a memory write', identityClaim({ ...IDENTITY, gbrainWrites: ['remember'] })],
  [
    'S7: a psychological conclusion about the Area of Focus',
    identityClaim({
      ...IDENTITY,
      trace: trace({ result: { outcome: 'x', detections: [detection('area_of_focus_risk')] } }),
    }),
  ],

  // T2
  [
    'T2b: an Objective is proposed for the Area of Focus',
    healthyAreaOfFocusClaim({
      ...AREA_OF_FOCUS,
      ...spoken(
        { area_of_focus: { mode: 'Maintain' } },
        { area_of_focus: ['Варто поставити Objective для цієї сфери'] },
      ),
    }),
  ],
  [
    'T2b: something is said on a healthy Area of Focus, and not about an Objective',
    healthyAreaOfFocusClaim({
      ...AREA_OF_FOCUS,
      ...spoken(
        { area_of_focus: { mode: 'Maintain' } },
        { area_of_focus: ['Сфера тримається добре'] },
      ),
    }),
  ],
  [
    'T2b: a proposal',
    healthyAreaOfFocusClaim({ ...AREA_OF_FOCUS, proposals: [proposal('area_of_focus', 'Done')] }),
  ],
  [
    'T2c: the Objective is changed from what the person said',
    unreadableEvidenceClaim({
      ...UNREADABLE,
      after: worldOf({ objective: { name: 'Інша ціль' }, result: {} }),
    }),
  ],
  [
    'T2c: a proposal',
    unreadableEvidenceClaim({ ...UNREADABLE, proposals: [proposal('objective', 'Done')] }),
  ],
  [
    'T2c: two notifications',
    unreadableEvidenceClaim({
      ...UNREADABLE,
      trace: { ...UNREADABLE.trace, runtimeEffects: effects('delivery', 'delivery') },
    }),
  ],

  // S1
  [
    'S1: the dependency is not named',
    dependencySliceClaim({
      ...SLICE,
      detection: {
        ...DETECTION,
        trace: trace({ runtimeEffects: effects('comment', 'continuation') }),
      },
    }),
  ],
  [
    'S1: a follow-up due in under an hour',
    dependencySliceClaim({
      ...SLICE,
      detection: {
        ...DETECTION,
        continuations: [{ reasonCode: 'await_external_event', runAt: STARTED.toISOString() }],
      },
    }),
  ],
  [
    'S1: the run kept silent: no dependency is named, no thread and no follow-up',
    dependencyRaisedClaim(
      evidence({
        ...still(SLICE_WORLD),
        trace: trace({ result: { outcome: 'no_action', detections: [] } }),
      }),
    ),
  ],
  [
    'S1: there is no follow-up',
    dependencySliceClaim({ ...SLICE, detection: { ...DETECTION, continuations: [] } }),
  ],
  [
    'S1: the status is written before approval',
    dependencySliceClaim({
      ...SLICE,
      reply: { ...REPLY, after: worldOf({ ...SLICE_WORLD, waiting: { status: 'Done' } }) },
    }),
  ],
  [
    "S1: the person's reply with no proposal",
    dependencySliceClaim({ ...SLICE, reply: { ...REPLY, proposals: [] } }),
  ],
  [
    'S1: Failed is proposed',
    dependencySliceClaim({
      ...SLICE,
      reply: { ...REPLY, proposals: [proposal('waiting', 'Failed')] },
    }),
  ],
  [
    'S1: the executor did not execute',
    dependencySliceClaim({ ...SLICE, approval: { ...SLICE.approval, proposalStatus: 'conflict' } }),
  ],
  [
    'S1: the Task did not become Done',
    dependencySliceClaim({
      ...SLICE,
      approval: { ...SLICE.approval, task: page('waiting', { status: 'Waiting For' }) },
    }),
  ],
  [
    'S1: the recheck wakes the person',
    dependencySliceClaim({
      ...SLICE,
      recheck: { ...RECHECK, trace: trace({ runtimeEffects: effects('delivery') }) },
    }),
  ],
  [
    'S1: the recheck schedules a new continuation',
    dependencySliceClaim({
      ...SLICE,
      recheck: { ...RECHECK, continuations: [{ reasonCode: 'await_external_event', runAt: LEAD }] },
    }),
  ],
  [
    'S1: the closure writes a page to GBrain',
    dependencySliceClaim({ ...SLICE, closure: { ...CLOSURE, gbrainWrites: ['put_page'] } }),
  ],
  [
    'S1: the closure comments on the closed thread',
    dependencySliceClaim({
      ...SLICE,
      closure: {
        ...CLOSURE,
        ...spoken(
          { project: { status: 'Active' }, waiting: { status: 'Done' } },
          { waiting: ['Закрито'] },
        ),
      },
    }),
  ],
  ['S1: the anchor is not cited', dependencySliceClaim({ ...SLICE, detection: citing() })],
  [
    'S1: a foreign GBrain page is cited',
    dependencySliceClaim({ ...SLICE, detection: citing(['gbrain', 'projects/site']) }),
  ],
  [
    'S1: the anchor slug is named under another server',
    dependencySliceClaim({
      ...SLICE,
      detection: citing(['notion', `projects/${idOf('project').replaceAll('-', '')}`]),
    }),
  ],

  // S6
  ['S6: the decision is not recorded', closureDecisionClaim({ ...DECISION, gbrainWrites: [] })],
  [
    'S6: a page is written instead of a fact',
    closureDecisionClaim({ ...DECISION, gbrainWrites: [MEMORY_RECORD_TOOL, 'put_page'] }),
  ],
  [
    'S6: the closed thread got a comment',
    closureDecisionClaim({
      ...DECISION,
      ...spoken({ task: { status: 'Done' } }, { task: ['Дякую'] }),
    }),
  ],
  [
    'S6: a proposal at closure',
    closureDecisionClaim({ ...DECISION, proposals: [proposal('task', 'Done')] }),
  ],

  // Every observation must be able to fail on its own: otherwise it proves nothing.
  [
    'S2: the run read nothing in Notion',
    alternativePathClaim({ ...ALTERNATIVE, trace: trace({ toolCalls: [] }) }),
  ],
  [
    'S2: the alternative Task changed status',
    alternativePathClaim({
      ...ALTERNATIVE,
      after: withStatus(ALTERNATIVE.after, 'alternative', 'Done'),
    }),
  ],
  [
    'S3: the ordinary Task changed status',
    pausedProjectClaim({ ...PAUSED, after: withStatus(PAUSED.after, 'plain', 'Done') }, COMMITTED),
  ],
  [
    'S3: the waiting Task changed status',
    pausedProjectClaim(
      { ...PAUSED, after: withStatus(PAUSED.after, 'checking', 'Next Action') },
      COMMITTED,
    ),
  ],
  [
    'S3: two notifications',
    pausedProjectClaim(
      {
        ...PAUSED,
        trace: { ...PAUSED.trace, runtimeEffects: effects('comment', 'delivery', 'delivery') },
      },
      COMMITTED,
    ),
  ],
  ...(['next', 'someday', 'finished'] as const).map((key): [string, Claim] => [
    `S4: the ${key} Task changed status`,
    terminalProjectClaim(
      { ...TERMINAL, after: withStatus(TERMINAL.after, key, 'Canceled') },
      OBLIGATIONS,
    ),
  ]),
  [
    'S4: the reply touched a Task the person did not name',
    terminalReplyClaim(
      { ...TERMINAL_REPLY, proposals: [...TERMINAL_REPLY.proposals, proposal('someday', 'Done')] },
      { outcomes: REPLY_OUTCOMES, untouched: REPLY_UNTOUCHED },
    ),
  ],
  [
    'S5: the blocker changed status',
    contradictionClaim({
      ...CONTRADICTION,
      after: withStatus(CONTRADICTION.after, 'blocker', 'Canceled'),
    }),
  ],
  [
    'S7: the Identity is edited',
    identityClaim({
      ...IDENTITY,
      after: worldOf({ ...IDENTITY_WORLD, identity: { name: 'Інше' } }),
    }),
  ],
  [
    'T2c: the Key Result is edited',
    unreadableEvidenceClaim({
      ...UNREADABLE,
      after: worldOf({ objective: {}, result: { name: 'Інше' } }),
    }),
  ],
  [
    'S1: a proposal before the person speaks',
    dependencyRaisedClaim({ ...DETECTION, proposals: [proposal('waiting', 'Done')] }),
  ],
  [
    'S1: after the recheck the Task waits again',
    dependencySliceClaim({
      ...SLICE,
      recheck: {
        ...RECHECK,
        after: worldOf({ project: { status: 'Active' }, waiting: { status: 'Waiting For' } }),
      },
    }),
  ],
  [
    'S1: the closure proposed something',
    dependencySliceClaim({
      ...SLICE,
      closure: { ...CLOSURE, proposals: [proposal('waiting', 'Canceled')] },
    }),
  ],
  [
    'S1: the closure moved the status',
    dependencySliceClaim({
      ...SLICE,
      closure: {
        ...CLOSURE,
        after: worldOf({ project: { status: 'Active' }, waiting: { status: 'Next Action' } }),
      },
    }),
  ],
  [
    'S6: the Task status is moved',
    closureDecisionClaim({ ...DECISION, after: worldOf({ task: { status: 'Next Action' } }) }),
  ],
];

describe('gate M5 claims', () => {
  it.each(PROVEN)('%s is proven', (_, claim) => {
    expect(claim.observations.filter((observation) => !observation.ok)).toEqual([]);
    expect(claim.ok).toBe(true);
  });

  it.each(DEVIATIONS)('%s, so the claim is not proven', (_, claim) => {
    expect(claim.ok).toBe(false);
    expect(claim.observations.some((observation) => !observation.ok)).toBe(true);
  });

  /**
   * An observation that no deviation fails proves nothing, because it could be comparing the wrong
   * thing.
   */
  it('every observation of the proven claims fails in at least one deviation', () => {
    const failing = new Set(
      DEVIATIONS.flatMap(([, claim]) =>
        claim.observations.filter((observation) => !observation.ok).map(({ item }) => item),
      ),
    );
    const everyItem = new Set(
      PROVEN.flatMap(([, claim]) => claim.observations.map(({ item }) => item)),
    );

    expect([...everyItem].filter((item) => !failing.has(item))).toEqual([]);
  });

  /**
   * Observations contain what should be and what is, because M10 counts shares from them. M5 does
   * not distinguish classes: everything is an effect.
   */
  it('every observation names what was expected and what was seen', () => {
    const [claim] = PROVEN.map(([, proven]) => proven);

    expect(claim?.observations.length).toBeGreaterThan(0);
    for (const observation of claim?.observations ?? []) {
      expect(Object.keys(observation).sort()).toEqual(['actual', 'expected', 'item', 'kind', 'ok']);
      expect(observation.kind).toBe('effect');
    }
  });

  it('PERSON and BOT are different authors, since the difference is what marks the voice of the system', () => {
    expect(PERSON).not.toBe(BOT);
  });
});

/**
 * The workspace's `Blocked` signal against the dependency rule: the formula returns nothing
 * exactly when there are no unclosed dependencies (`contracts/canonical.yaml`, key `signals`).
 */
describe('Blocked signal', () => {
  const flag = (value: boolean): ReturnType<typeof Read.value> =>
    Read.value({ type: 'flag', flag: value });

  it('an empty reading means `free`; any value means `blocked`; a boolean `false` means `free`', () => {
    expect(blockedFigureOf(Read.empty())).toEqual({ kind: 'free' });
    expect(blockedFigureOf(flag(true))).toEqual({ kind: 'blocked' });
    expect(blockedFigureOf(flag(false))).toEqual({ kind: 'free' });
    expect(blockedFigureOf(Read.value({ type: 'text', text: 'так' }))).toEqual({ kind: 'blocked' });
  });

  it('an unbound signal is neither an agreement nor a failure', () => {
    expect(blockedFigureOf(undefined)).toEqual({ kind: 'not_bound' });
  });

  it.each([
    ['unread', Read.unread('x')],
    ['absent', Read.absent('no carrier')],
    ['gap', Read.gap('task.blocked', 'odd')],
    ['non_canonical', Read.nonCanonical('x')],
  ] as const)('bound but `%s`, so there is nothing to compare with', (because, signal) => {
    expect(blockedFigureOf(signal)).toEqual({ kind: 'unreadable', because });
  });
});

/**
 * Restraint is proven by a run that looked at the world. Without that, “nothing was done” also
 * holds for a run that read nothing, so the positive baseline is a successful read of Notion
 * content.
 */
describe('run engagement', () => {
  const idle = (overrides: Partial<TraceView>): TraceView => trace(overrides);
  const NOTHING_READ = idle({ toolCalls: [] });
  const ONLY_PEOPLE = idle({
    toolCalls: [{ server: 'notion', tool: 'notion-get-users', ok: true }],
  });
  const FAILED_READ = idle({ toolCalls: [{ server: 'notion', tool: 'notion-fetch', ok: false }] });
  const GBRAIN_ONLY = idle({ toolCalls: [{ server: 'gbrain', tool: 'search', ok: true }] });

  const restraint: readonly [string, (given: Evidence) => Claim, Evidence][] = [
    ['S2', alternativePathClaim, ALTERNATIVE],
    ['S7', identityClaim, IDENTITY],
    ['T2b', healthyAreaOfFocusClaim, AREA_OF_FOCUS],
    ['T2c', unreadableEvidenceClaim, UNREADABLE],
    ['S5', contradictionClaim, CONTRADICTION],
    ['S3', paused, PAUSED],
  ];

  describe.each(restraint)('%s', (_, claimOf, base) => {
    it('a run that read Notion content is engaged', () => {
      expect(claimOf(base).ok).toBe(true);
    });

    it.each([
      ['read nothing', NOTHING_READ],
      ['read only the Notion user list', ONLY_PEOPLE],
      ['failed to read', FAILED_READ],
      ['read only GBrain', GBRAIN_ONLY],
    ])('a run that %s proves nothing', (__, empty) => {
      expect(claimOf({ ...base, trace: { ...base.trace, toolCalls: empty.toolCalls } }).ok).toBe(
        false,
      );
    });
  });
});

describe('scenario expectations', () => {
  it('an empty list does not pass silently but throws', () => {
    expect(() => pausedProjectClaim(PAUSED, { commitments: [] })).toThrow('names to look for');
    expect(() =>
      terminalProjectClaim(TERMINAL, { obligationNames: [], taskKeys: OBLIGATIONS.taskKeys }),
    ).toThrow('unfinished Tasks to be named');
    expect(() =>
      terminalReplyClaim(TERMINAL_REPLY, { outcomes: {}, untouched: REPLY_UNTOUCHED }),
    ).toThrow('Tasks named by the person');
  });

  it('a key the world does not have throws instead of matching everything', () => {
    expect(() =>
      contradictionClaim({ ...CONTRADICTION, after: worldOf({ blocker: { status: 'Done' } }) }),
    ).toThrow('has no page dependent');
  });

  it('a name in a comment matches regardless of case', () => {
    const lowercased = spoken(PAUSED_WORLD, {
      project: ['Проєкт на паузі, а «внести аванс бригаді» має дедлайн: що з ним?'],
    });

    expect(paused({ ...PAUSED, ...lowercased }).ok).toBe(true);
  });
});

describe('run comments', () => {
  /** An old comment by the same bot with the same text does not mask a new one. */
  it('a new comment with the text of an old one is new', () => {
    const old = { ...said('Проєкт під ризиком'), id: 'comment-old' };
    const claim = alternativePathClaim({
      ...ALTERNATIVE,
      before: worldOf({ ...ALTERNATIVE_WORLD, project: { status: 'Active', comments: [old] } }),
      after: worldOf({
        ...ALTERNATIVE_WORLD,
        project: { status: 'Active', comments: [old, said('Проєкт під ризиком')] },
      }),
    });

    expect(claim.ok).toBe(false);
  });

  it('an old comment is not counted as new', () => {
    const old = { ...said('Проєкт під ризиком'), id: 'comment-old' };
    const world = worldOf({ ...ALTERNATIVE_WORLD, project: { status: 'Active', comments: [old] } });

    expect(alternativePathClaim({ ...ALTERNATIVE, before: world, after: world }).ok).toBe(true);
  });
});

describe('page fields', () => {
  /**
   * Each field is compared on its own: a change shows even when the page was edited in the same
   * minute.
   */
  it.each([
    ['name', { name: 'Інша назва' }],
    ['mode', { mode: 'Advance' }],
    ['date', { date: '2026-10-09' }],
    ['deadline', { deadline: '2026-10-10' }],
    ['trash', { inTrash: true }],
  ])('a change in the %s of the Area of Focus shows', (_, changed) => {
    const claim = healthyAreaOfFocusClaim({
      ...AREA_OF_FOCUS,
      before: worldOf({ area_of_focus: { mode: 'Maintain' } }),
      after: worldOf({ area_of_focus: { mode: 'Maintain', ...changed } }),
    });

    expect(claim.ok).toBe(false);
  });

  it('a vanished page is a change', () => {
    expect(healthyAreaOfFocusClaim({ ...AREA_OF_FOCUS, after: {} }).ok).toBe(false);
  });
});

describe('one label, not a sum of different ones', () => {
  const split = (
    first: readonly [string, string],
    second: readonly [string, string],
  ): Evidence => ({
    ...CONTRADICTION,
    trace: trace({
      runtimeEffects: effects('comment'),
      result: {
        outcome: 'attention_raised',
        detections: [detection('contradiction', first), detection('contradiction', second)],
      },
    }),
  });

  it('a contradiction that cites each side with a separate label is not named', () => {
    expect(contradictionClaim(split(REFS.dependent, REFS.blocker)).ok).toBe(false);
  });

  it('a contradiction that cites both sides with one label is named', () => {
    expect(contradictionClaim(CONTRADICTION).ok).toBe(true);
  });

  it('the dependency rests on the Task that the dependency label itself cites', () => {
    const elsewhere = {
      ...SLICE,
      detection: {
        ...DETECTION,
        trace: trace({
          runtimeEffects: effects('comment', 'continuation'),
          result: {
            outcome: 'attention_raised',
            detections: [
              detection('dependency', REFS.project),
              detection('deadline_risk', REFS.waiting),
            ],
          },
        }),
      },
    };

    expect(dependencySliceClaim(elsewhere).ok).toBe(false);
  });
});

describe('what is unobserved', () => {
  it('a flow without the closure step holds, but the closure is unobserved', () => {
    const claim = dependencySliceClaim({ ...SLICE, closure: null });

    expect(claim.ok).toBe(true);
    expect(claim.unobserved).toEqual([UNOBSERVED_CLOSURE]);
  });

  it('a full flow leaves nothing unobserved', () => {
    expect(dependencySliceClaim(SLICE).unobserved).toEqual([]);
  });
});
