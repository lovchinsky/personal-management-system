import { Test } from '@nestjs/testing';
import {
  addDays,
  addHours,
  addSeconds,
  addWeeks,
  hoursToSeconds,
  secondsToMilliseconds,
  subHours,
  subSeconds,
} from 'date-fns';
import { RecordingNotionWaitNotice } from '../../test/fixtures/notion-wait-notice';
import { RecordingEffects } from '../../test/fixtures/recording-effects';
import {
  A_REPORT,
  A_RESULT,
  AN_OBSERVATION,
  completed,
  deferred,
  NO_EFFECTS,
  unreachable,
} from '../../test/fixtures/run-outcome.fixture';
import { unreached } from '../../test/fixtures/test-module';
import { budgetConfig, type BudgetConfig } from './budget.config';
import { NOTION_WAIT_NOTICE } from './notion-wait-notice';
import { AbsentRunEffects, EffectsReport, RUN_EFFECTS, type RunEffects } from './run-effects';
import { ClosedGate, RunGates } from './run-gates';
import { RunOutcome } from './run-outcome';
import { Conclusion, RunTraceRepository, Ticket } from './run-trace.repository';
import { DispatchRequest, DispatchResult, RunDispatcher } from './run.dispatcher';
import { AdmittedRun, Readiness, RUN_LAUNCHER, RunLauncher, RunShape } from './run.launcher';
import { runsConfig, type RunsConfig } from './runs.config';
import { eventEnvelope } from './trigger-envelope';

const TICKET_SECONDS = 900;
const TICKET_MS = secondsToMilliseconds(TICKET_SECONDS);

/** The log of a run's steps: the order of the steps is itself asserted. */
const steps: string[] = [];

const REQUEST: DispatchRequest = {
  envelope: eventEnvelope('event_evaluation', {
    type: 'page.properties_updated',
    event_types: ['page.properties_updated'],
    event_id: 'evt-1',
    timestamp: '2026-09-26T10:00:00.000Z',
    entity_id: 'page-1',
    page_id: 'page-1',
    updated_property_ids: [],
  }),
  provenance: { origin: 'evaluation_window' },
  recordAttempt: () => {
    steps.push('attempt');

    return Promise.resolve();
  },
};

/** The ticket that admission returns to the dispatcher. `admit` sets the expiry. */
const ADMITTED: Ticket = { id: 'run-1', expiresAt: new Date(0) };

const RUNS: RunsConfig = {
  ticketSeconds: TICKET_SECONDS,
  windDownSeconds: 60,
  tickSeconds: 15,
  planQuotaBackoffSeconds: hoursToSeconds(1),
  notionHoldMinMinutes: 15,
  notionHoldMaxMinutes: 60,
  notionHoldLimitHours: 24,
};

const BUDGET: BudgetConfig = { ...budgetConfig(), concurrency: 1 };

const READY: Readiness = { ready: true };

interface Dispatch {
  readonly dispatcher: RunDispatcher;
  readonly concluded: Conclusion[];
  readonly admitted: Ticket[];
  readonly effects: RecordingEffects;
  readonly notice: RecordingNotionWaitNotice;
  /** Revokes the ticket: the run's conclusion can no longer be written anywhere. */
  readonly retire: () => void;
}

/**
 * Builds the dispatcher over stub limits, a stub ledger and the App side.
 *
 * The tests here check what the dispatcher decides itself: how it keeps a run within its ticket
 * and what it does with the run's effects. Checking that needs controlled time, not a live
 * database. The limits, admission and the writing of the conclusion are checked by the integration
 * lane (`test/integration/run-budget.spec.ts`).
 */
async function dispatcherOver(launcher: RunLauncher, closed?: ClosedGate): Promise<Dispatch> {
  const concluded: Conclusion[] = [];
  const admitted: Ticket[] = [];
  const effects = new RecordingEffects();
  const notice = new RecordingNotionWaitNotice();
  let recorded = true;

  effects.onStep = (step) => steps.push(step);

  const gates: Pick<RunGates, 'check'> = {
    check: () => {
      steps.push('gates');

      return Promise.resolve(closed);
    },
  };
  const traces: Pick<RunTraceRepository, 'admit' | 'conclude'> = {
    admit: () => {
      const ticket: Ticket = { ...ADMITTED, expiresAt: addSeconds(new Date(), TICKET_SECONDS) };

      steps.push('admit');
      admitted.push(ticket);

      return Promise.resolve(ticket);
    },
    conclude: (_id: string, conclusion: Conclusion) => {
      steps.push('conclude');
      concluded.push(conclusion);

      return Promise.resolve(recorded);
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      RunDispatcher,
      { provide: RunGates, useValue: gates },
      { provide: RunTraceRepository, useValue: traces },
      { provide: budgetConfig.KEY, useValue: BUDGET },
      { provide: runsConfig.KEY, useValue: RUNS },
      { provide: RUN_LAUNCHER, useValue: launcher },
      { provide: RUN_EFFECTS, useValue: effects },
      { provide: NOTION_WAIT_NOTICE, useValue: notice },
    ],
  }).compile();

  return {
    dispatcher: moduleRef.get(RunDispatcher),
    concluded,
    admitted,
    effects,
    notice,
    retire: () => {
      recorded = false;
    },
  };
}

/**
 * Returns the text of the abort reason.
 *
 * The reason is read by shape, not through `instanceof Error`: `DOMException` comes from Node's
 * realm, not from the jest sandbox, and a class check returns a false answer here.
 */
function reasonOf(signal: AbortSignal): string {
  const reason: unknown = signal.reason;

  return typeof reason === 'object' && reason !== null && 'message' in reason
    ? String(reason.message)
    : String(reason);
}

/** A run that works until it is aborted and then responds with `answer`. */
class UntilAborted implements RunLauncher {
  readonly available = true;
  readonly runs: AdmittedRun[] = [];

  readiness(): Promise<Readiness> {
    return Promise.resolve(READY);
  }

  constructor(
    private readonly answer: (signal: AbortSignal) => RunOutcome = (signal) => ({
      status: 'failed',
      error: reasonOf(signal),
    }),
  ) {}

  launch(run: AdmittedRun): Promise<RunOutcome> {
    this.runs.push(run);

    return new Promise((resolve) => {
      run.signal.addEventListener('abort', () => resolve(this.answer(run.signal)));
    });
  }
}

/** A run that ended on its own, with an outcome or an exception, without waiting for the signal. */
class Immediate implements RunLauncher {
  readonly available = true;
  readonly runs: AdmittedRun[] = [];

  readiness(): Promise<Readiness> {
    return Promise.resolve(READY);
  }

  constructor(private readonly answer: () => Promise<RunOutcome>) {}

  launch(run: AdmittedRun): Promise<RunOutcome> {
    this.runs.push(run);
    steps.push('launch');

    return this.answer();
  }
}

const answering = (outcome: RunOutcome): Immediate => new Immediate(() => Promise.resolve(outcome));

beforeEach(() => {
  steps.length = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the dispatcher', () => {
  /**
   * An expired ticket hands the slot to the next run, and the run's process has no timeout of its
   * own. A run that was not aborted would work alongside that next one, and the concurrency limit
   * would stop being a limit.
   *
   * The bounds are checked from both sides: the abort comes no earlier than half the ticket and no
   * later than half a minute before its end, so the conclusion has time to be recorded in the row
   * while the row still belongs to the run.
   */
  it('aborts a run with a signal before the ticket expires, leaving time to report', async () => {
    const launcher = new UntilAborted();
    const { dispatcher, concluded } = await dispatcherOver(launcher);

    const dispatched = dispatcher.dispatch(REQUEST);

    await jest.advanceTimersByTimeAsync(TICKET_MS / 2);

    expect(launcher.runs[0].signal.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(TICKET_MS / 2 - secondsToMilliseconds(30));

    expect(launcher.runs[0].signal.aborted).toBe(true);

    await expect(dispatched).resolves.toMatchObject({
      started: true,
      verdict: 'failed',
      notionReached: false,
    });
    expect(concluded).toEqual([
      expect.objectContaining({ status: 'failed', error: 'run reached its ticket deadline' }),
    ]);
  });

  /**
   * `RunActor` is composed from the `id` and the origin: the one on whose behalf the run invokes
   * the capabilities, while the App MCP address and bearer are issued by the App session for this
   * particular row. The ticket expiry is the time the tokens of the run's servers must live until.
   */
  it("launches a run with its ledger row, origin, ticket expiry and its session's App MCP", async () => {
    const launcher = answering({ status: 'failed', error: 'done early' });
    const { dispatcher, admitted, effects } = await dispatcherOver(launcher);
    const before = new Date();

    await dispatcher.dispatch(REQUEST);

    const expected: Pick<AdmittedRun, 'id' | 'provenance' | 'expiresAt' | 'app'> = {
      id: ADMITTED.id,
      provenance: REQUEST.provenance,
      expiresAt: admitted[0].expiresAt,
      app: { url: 'http://127.0.0.1:3000/mcp', bearer: effects.sessions[0].bearer },
    };
    const { grant } = effects.sessions[0];

    expect(launcher.runs[0]).toMatchObject(expected);
    expect(grant).toMatchObject({
      runId: ADMITTED.id,
      mode: 'event_evaluation',
      provenance: REQUEST.provenance,
    });
    // The time of admission: capabilities measure the limits they set on the run from it.
    expect(grant.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(grant.startedAt.getTime()).toBeLessThanOrEqual(new Date().getTime());
    // The run's writes are applied up to the same deadline that stops the runner.
    expect(grant.deadline).toBe(launcher.runs[0].signal);
  });

  /**
   * A value belonging to one run travels with it: there is no separate state that must be set
   * before launch.
   */
  it("passes the run's shape to the runner; an ordinary run has none", async () => {
    const launcher = answering({ status: 'failed', error: 'done early' });
    const { dispatcher } = await dispatcherOver(launcher);
    const shape: RunShape = { instructions: 'Do exactly this.', model: 'claude-opus-9-9' };

    await dispatcher.dispatch({ ...REQUEST, shape });
    await dispatcher.dispatch(REQUEST);

    expect(launcher.runs.map((run) => run.shape)).toEqual([shape, undefined]);
  });

  it('sends no signal to a run that finished in time', async () => {
    const launcher = answering({ status: 'failed', error: 'done early' });
    const { dispatcher } = await dispatcherOver(launcher);

    await dispatcher.dispatch(REQUEST);
    await jest.advanceTimersByTimeAsync(TICKET_MS);

    expect(launcher.runs[0].signal.aborted).toBe(false);
  });

  it('sends no signal to a run that ended in an exception and leaves no writes', async () => {
    const launcher = new Immediate(() => Promise.reject(new Error('subprocess died')));
    const { dispatcher, concluded, effects } = await dispatcherOver(launcher);

    await expect(dispatcher.dispatch(REQUEST)).rejects.toThrow('subprocess died');
    await jest.advanceTimersByTimeAsync(TICKET_MS);

    const expected: Conclusion[] = [
      {
        status: 'failed',
        latencyMs: expect.any(Number),
        error: 'subprocess died',
        effects: NO_EFFECTS,
      },
    ];

    expect(launcher.runs[0].signal.aborted).toBe(false);
    expect(concluded).toEqual(expected);
    expect(effects.endings()).toEqual(['discarded']);
  });

  it('stops startup when the ticket is shorter than the wind-down allowance', async () => {
    const short: RunsConfig = { ...RUNS, ticketSeconds: 60, windDownSeconds: 60 };

    await expect(
      Test.createTestingModule({
        providers: [
          RunDispatcher,
          unreached(RunGates),
          unreached(RunTraceRepository),
          { provide: budgetConfig.KEY, useValue: BUDGET },
          { provide: runsConfig.KEY, useValue: short },
          { provide: RUN_LAUNCHER, useValue: new UntilAborted() },
          { provide: RUN_EFFECTS, useValue: new RecordingEffects() },
          { provide: NOTION_WAIT_NOTICE, useValue: new RecordingNotionWaitNotice() },
        ],
      }).compile(),
    ).rejects.toThrow('runs.ticketSeconds must exceed');
  });
});

/**
 * App writes are applied only when the run ended with a valid result (ADR 0014), and the
 * dispatcher makes that decision, because only the dispatcher knows both the outcome and the
 * deadline.
 */
describe('App effects', () => {
  /**
   * The run gates come before admission: admission creates the ledger row, that is, spends the
   * limit. The session opens before the attempt is recorded, and the conclusion is written after
   * the writes are applied.
   */
  it('the steps run in order: run gates, admission, session, attempt, launch, applying, conclusion', async () => {
    const { dispatcher } = await dispatcherOver(answering(completed()));

    await dispatcher.dispatch(REQUEST);

    expect(steps).toEqual(['gates', 'admit', 'open', 'attempt', 'launch', 'commit', 'conclude']);
  });

  it('a completed run applies its writes, and the ledger gets all three snapshots', async () => {
    const { dispatcher, concluded, effects } = await dispatcherOver(answering(completed()));
    const applied: EffectsReport = {
      applied: [{ kind: 'delivery', id: 'outbox-1' }],
      refused: [{ tool: 'schedule_continuation', reason: 'runAt must be in the future' }],
    };

    effects.committing = applied;

    const result = await dispatcher.dispatch(REQUEST);

    const expected: Conclusion[] = [
      {
        status: 'completed',
        latencyMs: expect.any(Number),
        report: A_REPORT,
        observation: AN_OBSERVATION,
        result: A_RESULT,
        effects: applied,
      },
    ];

    expect(result).toEqual({
      started: true,
      traceId: ADMITTED.id,
      verdict: 'completed',
      notionReached: true,
    });
    expect(concluded).toEqual(expected);
  });

  /**
   * An outcome that arrived within the ticket only after the abort does not apply the writes: the
   * ticket is already handing the slot to the next run, and the effects would land alongside its
   * run. The run itself is a failure: it did not fit within its ticket.
   */
  it('the deadline blocks applying even a valid result', async () => {
    const launcher = new UntilAborted(() => completed());
    const { dispatcher, concluded, effects } = await dispatcherOver(launcher);

    const dispatched = dispatcher.dispatch(REQUEST);

    await jest.advanceTimersByTimeAsync(TICKET_MS);

    await expect(dispatched).resolves.toMatchObject({
      started: true,
      verdict: 'failed',
      notionReached: true,
    });
    expect(effects.endings()).toEqual(['discarded']);
    expect(concluded).toEqual([
      expect.objectContaining({
        status: 'failed',
        error: 'run reached its ticket deadline',
        report: A_REPORT,
        result: A_RESULT,
      }),
    ]);
  });

  /**
   * A refusal to apply even one write fails the run: the message it composed may have announced
   * that write. The applied prefix stays in the ledger.
   */
  it('writes that were not applied make a completed run a failure', async () => {
    const { dispatcher, concluded, effects } = await dispatcherOver(answering(completed()));
    const stopped: EffectsReport = {
      applied: [{ kind: 'continuation', id: 'check-1' }],
      refused: [],
      failure: 'proposal: tool is not in the executor registry',
    };

    effects.committing = stopped;

    await expect(dispatcher.dispatch(REQUEST)).resolves.toMatchObject({
      verdict: 'failed',
      notionReached: true,
    });
    expect(concluded).toEqual([
      expect.objectContaining({
        status: 'failed',
        error: 'App effects not applied: proposal: tool is not in the executor registry',
        effects: stopped,
        result: A_RESULT,
      }),
    ]);
  });

  const discarding: [string, RunOutcome][] = [
    ['failed', { status: 'failed', error: 'structured output invalid' }],
    ['deferred', deferred()],
  ];

  it.each(discarding)('a %s run applies no writes', async (_, outcome) => {
    const { dispatcher, effects } = await dispatcherOver(answering(outcome));

    await dispatcher.dispatch(REQUEST);

    expect(effects.endings()).toEqual(['discarded']);
  });

  /** A runner without the App MCP would launch runs with nowhere to write. */
  it('a runner without App MCP stops startup', async () => {
    const absent: RunEffects = new AbsentRunEffects();

    await expect(
      Test.createTestingModule({
        providers: [
          RunDispatcher,
          unreached(RunGates),
          unreached(RunTraceRepository),
          { provide: budgetConfig.KEY, useValue: BUDGET },
          { provide: runsConfig.KEY, useValue: RUNS },
          { provide: RUN_LAUNCHER, useValue: answering(completed()) },
          { provide: RUN_EFFECTS, useValue: absent },
          { provide: NOTION_WAIT_NOTICE, useValue: new RecordingNotionWaitNotice() },
        ],
      }).compile(),
    ).rejects.toThrow('a runner is wired without App MCP');
  });
});

/**
 * The plan quota is not a failure (ADR 0012): the run ends deferred, and the ledger keeps the reset
 * time. Until then the run gates let no run through.
 */
describe('plan quota', () => {
  const untilOf = (conclusion: Conclusion | undefined): number =>
    conclusion?.status === 'deferred' && conclusion.cause === 'plan_quota'
      ? conclusion.until.getTime()
      : Number.NaN;

  it('a deferred run waits until the time the quota event states', async () => {
    const resetsAt = addHours(new Date(), 2);
    const { dispatcher, concluded } = await dispatcherOver(answering(deferred(resetsAt)));

    const result = await dispatcher.dispatch(REQUEST);
    const expected: DispatchResult = {
      started: true,
      traceId: ADMITTED.id,
      verdict: 'plan_quota',
      notionReached: true,
    };

    expect(result).toEqual(expected);
    expect(concluded).toEqual([
      expect.objectContaining({ status: 'deferred', until: resetsAt, report: A_REPORT }),
    ]);
  });

  const unknown: [string, Date | undefined][] = [
    ['an unknown', undefined],
    ['a past', subSeconds(new Date(), 1)],
  ];

  it.each(unknown)('%s reset time means an hour', async (_, resetsAt) => {
    const { dispatcher, concluded } = await dispatcherOver(answering(deferred(resetsAt)));

    await dispatcher.dispatch(REQUEST);

    expect(untilOf(concluded[0])).toBe(addHours(new Date(), 1).getTime());
  });

  /**
   * No run starts before that time, so an error in the report without a ceiling would silently
   * stop the system for a long time.
   */
  it('a time beyond the longest plan window is capped at a week', async () => {
    const { dispatcher, concluded } = await dispatcherOver(
      answering(deferred(addDays(new Date(), 30))),
    );

    await dispatcher.dispatch(REQUEST);

    expect(untilOf(concluded[0])).toBe(addWeeks(new Date(), 1).getTime());
  });
});

/**
 * Closed run gates are a denial before admission: no ledger row, no session, no attempt, no
 * launch. The answer contains only the reason, and the origin row stays as it was: the scheduler
 * checks the gates (`INV-084`).
 */
describe('closed run gates', () => {
  const closed: ClosedGate[] = [
    { denial: 'runner_absent', detail: 'no runner is wired' },
    { denial: 'runner_not_ready', detail: 'Notion MCP is not authorized' },
    { denial: 'plan_quota', until: addHours(new Date(), 3) },
    { denial: 'breaker' },
    { denial: 'daily_limit', until: addHours(new Date(), 1) },
  ];

  it.each(closed)('$denial is a denial without admission or launch', async (gate) => {
    const launcher = answering(completed());
    const { dispatcher, admitted, effects } = await dispatcherOver(launcher, gate);

    const expected: DispatchResult = { started: false, denial: gate.denial };

    await expect(dispatcher.dispatch(REQUEST)).resolves.toEqual(expected);
    expect(admitted).toHaveLength(0);
    expect(effects.sessions).toHaveLength(0);
    expect(launcher.runs).toHaveLength(0);
    expect(steps).toEqual(['gates']);
  });
});

/**
 * A run that did not reach Notion (ADR 0045): the row waits, not the run gates. A person's snooze
 * does not wait; a row that has waited longer than the limit fails in the ordinary way; the
 * person who replied in the channel is told what is happening.
 */
describe('Notion unavailable', () => {
  const CHANNEL: DispatchRequest = {
    ...REQUEST,
    envelope: eventEnvelope('event_evaluation', {
      type: 'channel.message',
      event_types: ['channel.message', 'comment.created'],
      event_id: 'telegram:5501',
      timestamp: '2026-09-26T10:00:00.000Z',
      entity_id: 'page-1',
      page_id: 'page-1',
      discussion_id: 'discussion-1',
      updated_property_ids: [],
    }),
    provenance: { origin: 'channel_inbound' },
    originId: 'window-1',
  };

  it('the row waits: deferred with no `until` for the run gates, writes discarded', async () => {
    const { dispatcher, concluded, effects } = await dispatcherOver(answering(unreachable()));

    const result = await dispatcher.dispatch(REQUEST);
    const expected: DispatchResult = {
      started: true,
      traceId: ADMITTED.id,
      verdict: 'notion',
      notionReached: false,
    };

    expect(result).toEqual(expected);
    expect(concluded).toEqual([expect.objectContaining({ status: 'deferred', cause: 'notion' })]);
    expect(concluded[0]).not.toHaveProperty('until');
    expect(effects.endings()).toEqual(['discarded']);
  });

  /**
   * A person's reminder comes on time or not at all: past the attempt limit the App tells the
   * person (`INV-108`).
   */
  it("a person's snooze does not wait: a failure the breaker does not count", async () => {
    const { dispatcher, concluded } = await dispatcherOver(answering(unreachable()));

    const result = await dispatcher.dispatch({
      ...REQUEST,
      provenance: { origin: 'scheduled_check', reasonCode: 'user_snooze' },
    });

    expect(result).toMatchObject({ verdict: 'failed', notionReached: false });
    expect(concluded).toEqual([
      expect.objectContaining({ status: 'failed', notionUnavailable: true }),
    ]);
  });

  it('a deadline check waits like the rest', async () => {
    const { dispatcher } = await dispatcherOver(answering(unreachable()));

    const result = await dispatcher.dispatch({
      ...REQUEST,
      provenance: { origin: 'scheduled_check', reasonCode: 'deadline_followup' },
    });

    expect(result).toMatchObject({ verdict: 'notion' });
  });

  it('a row that has waited less than a day keeps waiting', async () => {
    const { dispatcher } = await dispatcherOver(answering(unreachable()));

    const result = await dispatcher.dispatch({
      ...REQUEST,
      notionHeldSince: subHours(new Date(), 23),
    });

    expect(result).toMatchObject({ verdict: 'notion' });
  });

  /**
   * The limit is a signal of a long outage: the failure is an ordinary one, and the breaker sees
   * it.
   */
  it('a row that has waited a day no longer waits: an ordinary failure', async () => {
    const { dispatcher, concluded } = await dispatcherOver(answering(unreachable()));

    const result = await dispatcher.dispatch({
      ...REQUEST,
      notionHeldSince: subHours(new Date(), 24),
    });

    expect(result).toMatchObject({ verdict: 'failed' });
    expect(concluded).toEqual([
      expect.objectContaining({ status: 'failed', notionHoldExpired: true }),
    ]);
    expect(concluded[0]).not.toHaveProperty('notionUnavailable');
  });

  it('a person who replied in the channel is told the reply comes once Notion works', async () => {
    const { dispatcher, notice } = await dispatcherOver(answering(unreachable()));

    await dispatcher.dispatch(CHANNEL);

    expect(notice.told).toEqual([
      ['waiting', { windowId: 'window-1', discussionId: 'discussion-1', pageId: 'page-1' }],
    ]);
  });

  it('a person whose window waited a day is told there will be no reply and to write again', async () => {
    const { dispatcher, notice } = await dispatcherOver(answering(unreachable()));

    await dispatcher.dispatch({ ...CHANNEL, notionHeldSince: subHours(new Date(), 25) });

    expect(notice.told).toEqual([
      ['gaveUp', { windowId: 'window-1', discussionId: 'discussion-1', pageId: 'page-1' }],
    ]);
  });

  it('a run that reached Notion tells the person nothing of the kind', async () => {
    const { dispatcher, notice } = await dispatcherOver(answering(completed()));

    await dispatcher.dispatch(CHANNEL);

    expect(notice.told).toEqual([]);
  });

  /**
   * The window has most likely been taken by another run already: the person does not hear two
   * voices about one window.
   */
  it('a run whose ticket was revoked tells the person nothing', async () => {
    const { dispatcher, notice, retire } = await dispatcherOver(answering(unreachable()));

    retire();
    await dispatcher.dispatch(CHANNEL);

    expect(notice.told).toEqual([]);
  });

  it('a failure of the notice does not break the deferral', async () => {
    const { dispatcher, notice } = await dispatcherOver(answering(unreachable()));

    notice.waiting = () => Promise.reject(new Error('the queue is down'));

    await expect(dispatcher.dispatch(CHANNEL)).resolves.toMatchObject({ verdict: 'notion' });
  });
});
