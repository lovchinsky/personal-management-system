import type { AppliedEffect } from '../../src/runs/run-effects';
import type { TraceView } from '../../src/runs/run-traces';
import { textsOf } from '../../src/texts/texts';
import type { PageSnapshot, ProposalView } from '../gate/gate-claims';
import type { World } from '../gate/m5-scenarios';
import {
  NOT_OBSERVED,
  type Evidence6,
  type Notice,
  type WrittenComment,
  type WrittenContinuation,
} from '../gate/m6-evidence';
import {
  worldOf as catalogWorldOf,
  clientOf,
  codeword,
  type ScenarioId,
} from '../gate/m6-scenarios';
import { NO_MEMORY } from '../gate/memory-evidence';
import { packetLength } from '../gate/packet-length';
import { PROFILE_MODEL } from './claude-stream.fixture';
import { INTEGRATION_BOT } from './notion-bot';

/**
 * Evidence of the gate M6 runs, assembled without Notion or the model, in exactly the form
 * `m6-claims.ts` sees it. Each scenario has an all-correct sample, from which the test derives the
 * violations observation by observation.
 */
export const BOT = INTEGRATION_BOT;
const STATUS = 'status-property';
export const TAG = '4821-u1-1';
export const THREAD = '11111111-2222-4333-8444-555555555555';
export const STARTED = new Date('2026-10-08T09:00:00Z');

export const idOf = (key: string): string => `${key}-aaaa-bbbb`;

/**
 * Builds the world's pages as they are read from Notion. The state the scenario describes is the
 * same before and after the run.
 */
function snapshotsOf(world: World): Record<string, PageSnapshot> {
  return Object.fromEntries(
    world.map((page): [string, PageSnapshot] => [
      page.key,
      {
        id: idOf(page.key),
        name: page.name,
        status: 'status' in page ? page.status : null,
        mode: page.type === 'area_of_focus' ? page.mode : null,
        lifecycle: page.type === 'behavior_system' ? page.lifecycle : null,
        date: page.type === 'task' && page.dateInDays !== undefined ? '2026-10-09' : null,
        deadline: page.type === 'task' && page.deadlineInDays !== undefined ? '2026-10-10' : null,
        inTrash: false,
        comments: [],
        dataSource: `ds-${page.type}`,
      },
    ]),
  );
}

let counter = 0;

/** Builds a run comment on a world page, by default in the person's thread. */
export function comment(key: string, text: string, thread: string = THREAD): WrittenComment {
  counter += 1;

  return {
    id: `comment-${counter}`,
    pageId: idOf(key),
    discussionId: thread,
    text,
    author: BOT,
  };
}

export const effects = (...kinds: AppliedEffect['kind'][]): AppliedEffect[] =>
  kinds.map((kind, index) => ({ kind, id: `${kind}-${index}` }));

function detection(
  type: string,
  uncertainties: readonly string[],
  ...refs: readonly (readonly [string, string])[]
): unknown {
  return {
    type,
    claim: 'Твердження',
    why_now: 'Тому що',
    evidence: refs.map(([server, ref]) => ({ server, ref })),
    counterevidence_checked: ['Перевірено'],
    uncertainties: [...uncertainties],
  };
}

export const ref = (key: string, server = 'notion'): readonly [string, string] => [
  server,
  idOf(key),
];

/** Builds the result of a run: labels whose evidence cites the same sources in the same way. */
export function result(
  types: readonly string[],
  refs: readonly (readonly [string, string])[] = [],
  uncertainties: readonly string[] = [],
): { outcome: string; detections: unknown[] } {
  return {
    outcome: types.length > 0 ? 'attention_raised' : 'no_action',
    detections: types.map((type) => detection(type, uncertainties, ...refs)),
  };
}

export const trace = (overrides: Partial<TraceView> = {}): TraceView => ({
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

export const NOTICE: Notice = {
  noticed: 'Договір від юристів досі не надійшов.',
  whyItMatters: 'Дедлайн післязавтра, іншого шляху нема.',
  ask: 'Нагадати їм сьогодні?',
  link: 'https://www.notion.so/page',
};

export const wakeUp = (key: string): WrittenContinuation => ({
  id: `check-${key}`,
  reasonCode: 'await_external_event',
  runAt: '2026-10-08T12:00:00.000Z',
  pageId: idOf(key),
  discussionId: THREAD,
});

/**
 * Everything the run wrote: the trace effects are derived from what was written, so they do not
 * diverge.
 */
interface Acts {
  readonly comments?: readonly WrittenComment[];
  readonly notices?: readonly Notice[];
  readonly continuations?: readonly WrittenContinuation[];
  readonly proposals?: readonly ProposalView[];
}

/** Builds evidence from the state of the world's pages. Everything else is empty by default. */
export function evidence(world: World, overrides: Partial<Evidence6> = {}): Evidence6 {
  const pages = snapshotsOf(world);

  return {
    step: 'run',
    trace: trace(),
    before: pages,
    after: pages,
    proposals: [],
    continuations: [],
    gbrainWrites: [],
    bot: BOT,
    statusProperty: STATUS,
    written: { comments: [], notices: [], packetLengths: [] },
    foreign: [],
    discussionId: null,
    observed: NOT_OBSERVED,
    reads: [],
    memory: NO_MEMORY,
    ...overrides,
  };
}

/** Builds evidence of a run that wrote something. The trace effects are exactly those written. */
export function acted(
  world: World,
  acts: Acts,
  outcome: { outcome: string; detections: unknown[] },
  overrides: Partial<Evidence6> = {},
): Evidence6 {
  const comments = acts.comments ?? [];
  const notices = acts.notices ?? [];
  const continuations = acts.continuations ?? [];
  const proposals = acts.proposals ?? [];

  return evidence(world, {
    trace: trace({
      result: outcome,
      runtimeEffects: effects(
        ...comments.map((): AppliedEffect['kind'] => 'comment'),
        ...continuations.map((): AppliedEffect['kind'] => 'continuation'),
        ...proposals.map((): AppliedEffect['kind'] => 'proposal'),
        ...notices.map((): AppliedEffect['kind'] => 'delivery'),
      ),
    }),
    written: {
      comments,
      notices,
      packetLengths: notices.map((notice) => packetLength(notice, textsOf('uk').telegram)),
    },
    continuations,
    proposals,
    ...overrides,
  });
}

/** Returns the scenario's world by its id, under the fixture's tag. */
export function worldOf(id: ScenarioId, tag: string = TAG): World {
  return catalogWorldOf(id, tag);
}

/** The steps of the W1 chain as `dependencyChainClaim` sees them. */
export interface Chain {
  readonly detection: Evidence6;
  readonly repeated: Evidence6;
  readonly recheck: Evidence6;
}

/**
 * Builds the W1 chain in which the run did everything it had to: a comment, a continuation, a
 * notification. The repeat stays silent.
 */
export function goodChain(tag: string = TAG): Chain {
  const world = worldOf('W1_dependency_chain', tag);

  return {
    detection: acted(
      world,
      {
        comments: [
          comment(
            'waiting',
            'Договір від юристів досі не прийшов, а дедлайн післязавтра. Нагадати їм?',
          ),
        ],
        notices: [NOTICE],
        continuations: [wakeUp('waiting')],
      },
      result(['dependency', 'deadline_risk'], [ref('waiting'), ref('project')]),
      { discussionId: THREAD },
    ),
    repeated: evidence(world, { discussionId: THREAD }),
    recheck: acted(world, { notices: [NOTICE] }, result(['deadline_risk'], [ref('waiting')]), {
      discussionId: THREAD,
    }),
  };
}

/**
 * Builds a run in which the person made a promise. The label is raised and one comment in the
 * person's thread mentions the promise. `notified` means the question also goes out as a
 * notification (the person replied from the channel).
 */
function promisedTo(id: ScenarioId, tag: string, notified = false): Evidence6 {
  return acted(
    worldOf(id, tag),
    {
      comments: [comment('prices', `Дякую. Записати обіцянку для «${clientOf(tag)}» як задачу?`)],
      ...(notified ? { notices: [NOTICE] } : {}),
    },
    result(['untracked_commitment'], [ref('prices')]),
    { discussionId: THREAD },
  );
}

/**
 * Builds a run that did everything it had to, for a scenario. The test derives the violations from
 * it. The W1 chain is not covered here, because its steps come from `goodChain`.
 */
export function good(id: ScenarioId, tag: string = TAG): Evidence6 {
  const world = worldOf(id, tag);
  const quiet = evidence(world);

  switch (id) {
    case 'U1_commitment':
    case 'E1_commitment_english':
      return promisedTo(id, tag);

    case 'U3_commitment_undated':
      return promisedTo(id, tag, true);

    case 'U2_commitment_tracked':
      return acted(
        world,
        {
          comments: [
            comment('prices', 'Схожа задача вже є в проєкті продажів, окремої не потрібно.'),
          ],
        },
        result([]),
        {
          discussionId: THREAD,
          trace: trace({
            toolCalls: [
              { server: 'notion', tool: 'notion-search', ok: true },
              { server: 'notion', tool: 'notion-fetch', ok: true },
            ],
            runtimeEffects: effects('comment'),
          }),
        },
      );

    case 'U4_commitment_intent':
    case 'U5_commitment_third_party':
      return evidence(world, { discussionId: THREAD });

    case 'P1_last_task_done':
      return acted(
        world,
        {
          comments: [
            comment(
              'project',
              'Усі задачі проєкту виконані. Закрити його чи додати наступний крок?',
            ),
          ],
        },
        result(['project_integrity'], [ref('project')]),
      );

    case 'K1_blocked_next_action':
      return acted(
        world,
        {
          comments: [
            comment(
              'dependent',
              'Ця задача позначена як наступна дія, а її блокує інша, ще не виконана.',
            ),
          ],
        },
        result(['contradiction'], [ref('dependent'), ref('blocker')]),
      );

    case 'F1_lesson_applies':
      return acted(
        world,
        {
          comments: [
            comment(
              'waiting',
              `Юристи не підпишуть, доки не отримають макети «${codeword(tag)}». Надіслати їм?`,
            ),
          ],
        },
        result(
          ['forgotten_context'],
          [['gbrain', `projects/${idOf('project').replaceAll('-', '')}`], ref('waiting')],
        ),
      );

    case 'F2_lesson_elsewhere':
      return evidence(world, {
        trace: trace({
          toolCalls: [
            { server: 'notion', tool: 'notion-fetch', ok: true },
            { server: 'gbrain', tool: 'search', ok: true },
          ],
        }),
      });

    case 'N2_deadline_passed':
      return acted(
        world,
        { comments: [comment('late', 'Дедлайн минув, а задача ще відкрита. Що з нею робимо?')] },
        result(['deadline_risk'], [ref('late')]),
      );

    default:
      return quiet;
  }
}
