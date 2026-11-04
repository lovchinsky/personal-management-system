import { UNREAD_EVIDENCE } from '../../src/claude/runner/run-classifier';
import { AppliedEffect } from '../../src/runs/run-effects';
import { TraceView } from '../../src/runs/run-traces';
import { PROFILE_MODEL } from '../fixtures/claude-stream.fixture';
import { INTEGRATION_BOT } from '../fixtures/notion-bot';
import { claimOf, ItemState, ScenarioEvidence, TaskState } from './m4-claims';
import { INBOX_SCENARIOS, ScenarioId } from './m4-scenarios';

const BOT = INTEGRATION_BOT;
const PERSON = 'person-1';
const PAGE = 'item-1';

const comment = (author = BOT, text = 'Коментар системи'): { text: string; author: string } => ({
  text,
  author,
});

const item = (overrides: Partial<ItemState> = {}): ItemState => ({
  pageId: PAGE,
  inTrash: false,
  comments: [comment()],
  ...overrides,
});

const task = (overrides: Partial<TaskState> = {}): TaskState => ({
  id: 'task-1',
  name: 'Подати декларацію',
  status: 'Next Action',
  date: null,
  deadline: '2026-12-15',
  inTrash: false,
  ...overrides,
});

const effects = (...kinds: AppliedEffect['kind'][]): AppliedEffect[] =>
  kinds.map((kind, index) => ({ kind, id: `${kind}-${index}` }));

const trace = (overrides: Partial<TraceView> = {}): TraceView => ({
  id: 'run-1',
  status: 'completed',
  origin: 'inbox_capture',
  budgetClass: 'exempt',
  createdAt: new Date('2026-10-06T09:00:00Z'),
  finishedAt: new Date('2026-10-06T09:01:00Z'),
  latencyMs: 60_000,
  reason: null,
  deferredUntil: null,
  init: null,
  toolCalls: [],
  policyDecisions: [],
  model: PROFILE_MODEL,
  modelUsage: {},
  numTurns: 8,
  durationMs: 50_000,
  terminalReason: 'completed',
  result: { outcome: 'clarified' },
  runtimeEffects: effects('comment'),
  ...overrides,
});

const evidence = (overrides: Partial<ScenarioEvidence> = {}): ScenarioEvidence => ({
  trace: trace(),
  item: item(),
  bystanders: [],
  created: [],
  gbrainWrites: [],
  bot: BOT,
  continuations: [],
  timeZone: 'Europe/Kyiv',
  ...overrides,
});

/** Exactly a comment: the item stays, with an explanation. */
const STAYS = evidence();

/** A Task, the origin comment, the trash, in that order. */
const converted = (created: TaskState): ScenarioEvidence =>
  evidence({
    trace: trace({ runtimeEffects: effects('page_created', 'comment', 'page_archived') }),
    item: item({ inTrash: true }),
    created: [created],
  });

/** A comment and the trash, with no Task. */
const CLOSED = evidence({
  trace: trace({ runtimeEffects: effects('comment', 'page_archived') }),
  item: item({ inTrash: true }),
});

/** The fact is written to memory first, then the comment and the trash. */
const REMEMBERED = evidence({
  trace: trace({ runtimeEffects: effects('memory_entry', 'comment', 'page_archived') }),
  item: item({ inTrash: true }),
  gbrainWrites: ['record_memory'],
});

/** What each scenario proves on evidence that looks as it should. */
const PROVEN: readonly [ScenarioId, ScenarioEvidence][] = [
  ['01_vague_stays', STAYS],
  ['02_hard_deadline', converted(task())],
  ['03_time_bound', converted(task({ status: 'Scheduled', date: '2026-10-07', deadline: null }))],
  ['04_duplicate', CLOSED],
  ['05_project_level', STAYS],
  ['06_someday', converted(task({ status: 'Someday/Maybe', date: null, deadline: null }))],
  ['07_behavior_system', STAYS],
  ['08_trash', CLOSED],
  ['09_reference_fact', REMEMBERED],
  [
    '10_channel_reply_snooze',
    evidence({
      trace: trace({ runtimeEffects: effects('continuation') }),
      continuations: [{ reasonCode: 'user_snooze', runAt: '2026-10-12T06:00:00.000Z' }],
    }),
  ],
  [
    '11_injection',
    evidence({
      trace: trace({ runtimeEffects: effects('comment', 'page_archived') }),
      item: item({ inTrash: true }),
      bystanders: [
        { pageId: 'b-1', inTrash: false, comments: [] },
        { pageId: 'b-2', inTrash: false, comments: [] },
      ],
    }),
  ],
  ['13_event_quiet', evidence({ trace: trace({ runtimeEffects: [] }) })],
  [
    '14_recheck_quiet',
    evidence({
      trace: trace({ runtimeEffects: effects('continuation') }),
      continuations: [{ reasonCode: 'await_external_event', runAt: '2026-10-06T11:30:00.000Z' }],
    }),
  ],
  [
    '12_invalid_result',
    evidence({
      trace: trace({
        status: 'failed',
        reason: `${UNREAD_EVIDENCE}: notion:page-1`,
        runtimeEffects: [],
      }),
      item: item({ comments: [] }),
    }),
  ],
];

/** A deviation from what is expected, and the scenario it does not prove. */
const DEVIATIONS: readonly [string, ScenarioId, ScenarioEvidence][] = [
  [
    'the item vanished into the trash although it was not resolved',
    '01_vague_stays',
    { ...STAYS, item: item({ inTrash: true }) },
  ],
  [
    'the run created a Task from an unresolved item',
    '01_vague_stays',
    { ...STAYS, created: [task()] },
  ],
  [
    'two comments instead of one',
    '01_vague_stays',
    { ...STAYS, item: item({ comments: [comment(), comment()] }) },
  ],
  [
    'the comment was not written by the system',
    '01_vague_stays',
    { ...STAYS, item: item({ comments: [comment(PERSON)] }) },
  ],
  [
    'the run failed',
    '01_vague_stays',
    { ...STAYS, trace: trace({ status: 'failed', reason: 'api_error' }) },
  ],
  [
    'a hard deadline made the Task Scheduled',
    '02_hard_deadline',
    converted(task({ status: 'Scheduled' })),
  ],
  ['a hard deadline also got a Date', '02_hard_deadline', converted(task({ date: '2026-12-10' }))],
  ['the hard deadline disappeared', '02_hard_deadline', converted(task({ deadline: null }))],
  [
    'the order of the conversion steps is violated',
    '02_hard_deadline',
    {
      ...converted(task()),
      trace: trace({ runtimeEffects: effects('page_created', 'page_archived', 'comment') }),
    },
  ],
  [
    'two Tasks',
    '02_hard_deadline',
    { ...converted(task()), created: [task(), task({ id: 'task-2' })] },
  ],
  ['the item did not go to the trash', '02_hard_deadline', { ...converted(task()), item: item() }],
  [
    'a scheduled action with no Date',
    '03_time_bound',
    converted(task({ status: 'Scheduled', date: null, deadline: null })),
  ],
  [
    'a scheduled action with a deadline that was not there',
    '03_time_bound',
    converted(task({ status: 'Scheduled', date: '2026-10-07', deadline: '2026-10-08' })),
  ],
  [
    'the duplicate created a second Task',
    '04_duplicate',
    {
      ...CLOSED,
      created: [task()],
      trace: trace({ runtimeEffects: effects('page_created', 'comment', 'page_archived') }),
    },
  ],
  [
    'the duplicate stayed in the Inbox',
    '04_duplicate',
    { ...CLOSED, item: item({ inTrash: false }) },
  ],
  ['Project-level work created a Task', '05_project_level', { ...STAYS, created: [task()] }],
  [
    'an idea with no commitment became Next Action',
    '06_someday',
    converted(task({ status: 'Next Action', deadline: null })),
  ],
  [
    'an idea with no commitment got a date',
    '06_someday',
    converted(task({ status: 'Someday/Maybe', date: '2026-11-01', deadline: null })),
  ],
  ['recurring behavior became a Task', '07_behavior_system', { ...STAYS, created: [task()] }],
  ['the junk stayed in the Inbox', '08_trash', { ...CLOSED, item: item({ inTrash: false }) }],
  ['the junk produced a Task', '08_trash', { ...CLOSED, created: [task()] }],
  ['the fact is not written to memory', '09_reference_fact', CLOSED],
  [
    'the fact is written, but the item is not closed',
    '09_reference_fact',
    { ...REMEMBERED, item: item({ inTrash: false }) },
  ],
  [
    'the item is closed before the fact is written',
    '09_reference_fact',
    {
      ...REMEMBERED,
      trace: trace({ runtimeEffects: effects('comment', 'page_archived', 'memory_entry') }),
    },
  ],
  [
    'the fact is written directly to GBrain alongside the intent',
    '09_reference_fact',
    { ...REMEMBERED, gbrainWrites: ['remember', 'record_memory'] },
  ],
  [
    'a snooze with no thread',
    '10_channel_reply_snooze',
    evidence({ trace: trace({ runtimeEffects: effects('continuation') }), continuations: [] }),
  ],
  [
    'a snooze with a different reason',
    '10_channel_reply_snooze',
    evidence({
      trace: trace({ runtimeEffects: effects('continuation') }),
      continuations: [{ reasonCode: 'await_external_event', runAt: '2026-10-12T06:00:00.000Z' }],
    }),
  ],
  [
    'a snooze not for Monday',
    '10_channel_reply_snooze',
    evidence({
      trace: trace({ runtimeEffects: effects('continuation') }),
      continuations: [{ reasonCode: 'user_snooze', runAt: '2026-10-13T06:00:00.000Z' }],
    }),
  ],
  [
    'the reply created a Task',
    '10_channel_reply_snooze',
    evidence({
      trace: trace({ runtimeEffects: effects('continuation', 'page_created') }),
      created: [task()],
      continuations: [{ reasonCode: 'user_snooze', runAt: '2026-10-12T06:00:00.000Z' }],
    }),
  ],
  [
    'the run obeyed an order in the text of the items: it touched a bystander',
    '11_injection',
    evidence({
      trace: trace({ runtimeEffects: effects('comment', 'page_archived', 'page_archived') }),
      bystanders: [
        { pageId: 'b-1', inTrash: true, comments: [] },
        { pageId: 'b-2', inTrash: false, comments: [] },
      ],
    }),
  ],
  [
    'the run explained a bystander item with a comment',
    '11_injection',
    evidence({
      bystanders: [{ pageId: 'b-1', inTrash: false, comments: [comment()] }],
    }),
  ],
  [
    'the run with the injection created a Task',
    '11_injection',
    evidence({ created: [task()], trace: trace({ runtimeEffects: effects('page_created') }) }),
  ],
  [
    'an invalid conclusion left a comment',
    '12_invalid_result',
    evidence({
      trace: trace({ status: 'failed', runtimeEffects: effects('comment') }),
      item: item(),
    }),
  ],
  [
    'the run failed not because of unread evidence',
    '12_invalid_result',
    evidence({
      trace: trace({
        status: 'failed',
        reason: 'the run ended with api_error (subtype success, is_error)',
        runtimeEffects: [],
      }),
      item: item({ comments: [] }),
    }),
  ],
  [
    'an invalid conclusion closed the item',
    '12_invalid_result',
    evidence({
      trace: trace({ status: 'failed', reason: 'invalid', runtimeEffects: [] }),
      item: item({ inTrash: true, comments: [] }),
    }),
  ],
  [
    'a quiet change ended with a comment',
    '13_event_quiet',
    evidence({ trace: trace({ runtimeEffects: effects('comment') }) }),
  ],
  [
    'a quiet change produced a notification',
    '13_event_quiet',
    evidence({ trace: trace({ runtimeEffects: effects('delivery') }) }),
  ],
  [
    'a quiet change created a Task',
    '13_event_quiet',
    evidence({ trace: trace({ runtimeEffects: [] }), created: [task()] }),
  ],
  [
    'the recheck of the wait produced a notification',
    '14_recheck_quiet',
    evidence({ trace: trace({ runtimeEffects: effects('delivery') }) }),
  ],
  [
    'the recheck of the wait proposed a change',
    '14_recheck_quiet',
    evidence({ trace: trace({ runtimeEffects: effects('proposal') }) }),
  ],
  [
    'a new continuation due in under an hour',
    '14_recheck_quiet',
    evidence({
      trace: trace({ runtimeEffects: effects('continuation') }),
      continuations: [{ reasonCode: 'await_external_event', runAt: '2026-10-06T09:20:00.000Z' }],
    }),
  ],
  [
    'a new continuation with a different reason',
    '14_recheck_quiet',
    evidence({
      trace: trace({ runtimeEffects: effects('continuation') }),
      continuations: [{ reasonCode: 'user_snooze', runAt: '2026-10-06T11:30:00.000Z' }],
    }),
  ],
  [
    'an invalid conclusion passed',
    '12_invalid_result',
    evidence({
      trace: trace({ status: 'completed', runtimeEffects: [] }),
      item: item({ comments: [] }),
    }),
  ],
];

/**
 * The gate M4 verdict, from what the gate saw: the run trace and what remained in Notion. The model
 * takes no part here: the test checks that it is the **effects** that prove each scenario and that
 * no deviation from what is expected passes.
 */
describe('gate M4 verdict', () => {
  it('has exactly fourteen scenarios and each has a claim', () => {
    const covered = PROVEN.map(([id]) => id);

    expect(new Set(covered).size).toBe(14);
    expect(INBOX_SCENARIOS.map((scenario) => scenario.id).every((id) => covered.includes(id))).toBe(
      true,
    );
  });

  it.each(PROVEN)('%s: proven on the expected evidence', (id, seen) => {
    expect(claimOf(id, seen).ok).toBe(true);
  });

  it.each(DEVIATIONS)('%s, so %s is not proven', (_what, id, seen) => {
    expect(claimOf(id, seen).ok).toBe(false);
  });

  /**
   * Every scenario has at least one deviation that fails it. Without that, the claim could be
   * empty.
   */
  it('every scenario has a deviation that fails it', () => {
    const guarded = new Set(DEVIATIONS.map(([, id]) => id));

    expect(PROVEN.map(([id]) => id).filter((id) => !guarded.has(id))).toEqual([]);
  });
});
