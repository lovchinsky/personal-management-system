import { Test, TestingModule } from '@nestjs/testing';
import { addHours, addMinutes, addSeconds, subHours, subSeconds } from 'date-fns';
import { appConfig } from '../../src/config/app.config';
import { evaluationWindowConfig } from '../../src/intake/notion/evaluation-window.config';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { BREAKER_NOTICE } from '../../src/runs/breaker-notice';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunProvenance } from '../../src/runs/provenance';
import { RunBudget } from '../../src/runs/run-budget';
import { RUN_EFFECTS } from '../../src/runs/run-effects';
import { ClosedGate, GateState, RunGates } from '../../src/runs/run-gates';
import { RunReport } from '../../src/runs/run-outcome';
import { RunTraceRepository } from '../../src/runs/run-trace.repository';
import { RunTraces, TraceView } from '../../src/runs/run-traces';
import { DispatchRequest, RunDispatcher } from '../../src/runs/run.dispatcher';
import { RUN_LAUNCHER, RunLauncher } from '../../src/runs/run.launcher';
import { runsConfig } from '../../src/runs/runs.config';
import { eventEnvelope, recheckEnvelope, TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { RecordingBreakerNotice } from '../fixtures/breaker-notice';
import { NOTION_WAIT_NOTICE_PROVIDER } from '../fixtures/notion-wait-notice';
import { RecordingEffects } from '../fixtures/recording-effects';
import {
  A_REPORT,
  A_RESULT,
  AN_OBSERVATION,
  deferred,
  failed,
  unreachable,
} from '../fixtures/run-outcome.fixture';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';
import {
  abandonedRun,
  completedRun,
  deferredRun,
  eventAbout,
  failedRun,
  fillDay,
  fillRuns,
  INIT_PART,
  notionDeferredRun,
  REPORT_PART,
  runningRun,
  withSnapshot,
} from './ledger-rows';
import { expectStartOfNextLocalDay } from './next-local-day.assert';
import { RecordingLauncher } from './recording-launcher';

/** The order “recording → launch” is an assertion, so the log is shared. */
const order: string[] = [];

/** Whom the run gates tell that the breaker has opened. */
const notice = new RecordingBreakerNotice();

/**
 * A run request in the form the scheduler submits it.
 *
 * Recording the attempt is a required field of the request, not an optional hook: otherwise an
 * origin that did not supply it would silently leave the attempt uncounted for a run it had
 * caused itself.
 */
function request(envelope: TriggerEnvelope, provenance: RunProvenance): DispatchRequest {
  return {
    envelope,
    provenance,
    recordAttempt: () => {
      order.push('attempt');

      return Promise.resolve();
    },
  };
}

const SYSTEM_STARTED: RunProvenance = { origin: 'evaluation_window' };
const PERSON_ASKED: RunProvenance = { origin: 'scheduled_check', reasonCode: 'user_snooze' };

const EVENT: TriggerEnvelope = eventEnvelope('event_evaluation', {
  type: 'page.properties_updated',
  event_types: ['page.properties_updated'],
  event_id: 'evt-1',
  timestamp: new Date().toISOString(),
  entity_id: 'page-1',
  page_id: 'page-1',
  updated_property_ids: ['aGCp'],
});

const RECHECK: TriggerEnvelope = recheckEnvelope({
  event_id: 'check-1:0',
  page_id: 'page-1',
  reason_code: 'user_snooze',
});

/**
 * The limit covers only what the system started itself — and rests on three different
 * mechanisms, which are checked separately here.
 *
 * The run gates (the runner and its readiness, the plan quota, the daily limit, the breaker)
 * answer the question “is it worth running currently”. Admission (a slot in the ledger) answers
 * “is there room”, and does so atomically: counting could not do it, because two runs would see
 * zero and both would start. A missing dependency is neither the first nor the second — it spends
 * nothing.
 */
describe('run budget', () => {
  let prisma: PrismaService;
  let traces: RunTraceRepository;
  let views: RunTraces;
  let dispatcher: RunDispatcher;
  let gates: RunGates;
  let launcher: RecordingLauncher;
  let effects: RecordingEffects;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    launcher = new RecordingLauncher();
    effects = new RecordingEffects();

    moduleRef = await Test.createTestingModule({
      imports: [
        testConfig(
          databaseConfig,
          appConfig,
          budgetConfig,
          runsConfig,
          evaluationWindowConfig,
          workersConfig,
        ),
      ],
      providers: [
        PrismaService,
        RunTraceRepository,
        RunTraces,
        RunBudget,
        RunGates,
        { provide: BREAKER_NOTICE, useValue: notice },
        NOTION_WAIT_NOTICE_PROVIDER,
        RunDispatcher,
        { provide: RUN_LAUNCHER, useValue: launcher },
        { provide: RUN_EFFECTS, useValue: effects },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    traces = moduleRef.get(RunTraceRepository);
    views = moduleRef.get(RunTraces);
    dispatcher = moduleRef.get(RunDispatcher);
    gates = moduleRef.get(RunGates);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    launcher.reset();
    effects.reset();
    order.length = 0;
    notice.told.length = 0;
    notice.failures = 0;
    launcher.onLaunch = () => order.push('launch');
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Returns the trace of the only run, as seen by whoever did not admit it. */
  async function onlyTrace(): Promise<TraceView> {
    const { id } = await prisma.runTrace.findFirstOrThrow();
    const view = await views.find(id);

    if (!view) {
      throw new Error(`trace ${id} vanished between two reads`);
    }

    return view;
  }

  /** Admits a run in an empty ledger and returns the id of its ticket. */
  async function admitted(ticketSeconds: number): Promise<string> {
    const ticket = await traces.admit({
      envelope: EVENT,
      origin: 'evaluation_window',
      budgetClass: 'budgeted',
      concurrency: 1,
      ticketSeconds,
    });

    if (!ticket) {
      throw new Error('the only slot was taken in an empty ledger');
    }

    return ticket.id;
  }

  describe('attempt recording for an origin', () => {
    /**
     * The order is the guarantee. A record written after the launch would be lost together with
     * the process the run killed, and an origin that reliably kills the run would loop forever,
     * because there is nobody left to report that the attempts are exhausted.
     */
    it('the attempt is recorded before the launch, not after', async () => {
      await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(order).toEqual(['attempt', 'launch']);
    });

    /** A budget denial launches no run, so there is nothing to count as an attempt. */
    it('a daily limit denial records no attempt', async () => {
      await fillDay(prisma);

      const denied = await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(denied.started).toBe(false);
      expect(order).toEqual([]);
    });

    it('a missing runner records no attempt', async () => {
      launcher.available = false;

      await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(order).toEqual([]);
    });

    /** A run that failed with an exception took place anyway — and must count as an attempt. */
    it('a run that fails with an exception still counts as an attempt', async () => {
      const boom = new Error('launcher exploded');

      jest.spyOn(launcher, 'launch').mockRejectedValueOnce(boom);

      await expect(dispatcher.dispatch(request(EVENT, SYSTEM_STARTED))).rejects.toThrow(boom);
      expect(order).toEqual(['attempt']);
    });
  });

  describe('ledger', () => {
    it('a successful run leaves a row with its class, slot and expiry', async () => {
      const result = await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(result).toEqual({
        started: true,
        traceId: expect.any(String),
        verdict: 'completed',
        notionReached: true,
      });

      const trace = await prisma.runTrace.findFirstOrThrow();

      expect(trace.budgetClass).toBe('budgeted');
      expect(trace.status).toBe('completed');
      expect(trace.slot).toBe(0);
      expect(trace.expiresAt.getTime()).toBeGreaterThan(addSeconds(new Date(), 800).getTime());
      expect(trace.latencyMs).not.toBeNull();
    });

    /**
     * A run's session is matched to its trace by construction: the runner takes the row id as the
     * `sessionId`, so no correspondence has to be looked up afterwards.
     */
    it('a run gets the identifier of its ledger row', async () => {
      const result = await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(result.started && result.traceId).toBe(launcher.runs[0].id);
      expect(launcher.runs[0].envelope).toEqual(EVENT);
    });

    /**
     * The three parts of the snapshot go into the trace whole — and with them what the App did
     * with the writes: what was applied goes into the effects, and the App's refusals sit beside
     * the perimeter's refusals.
     */
    it('a completed run leaves all three parts of the snapshot in the trace', async () => {
      effects.committing = {
        applied: [{ kind: 'delivery', id: 'outbox-1' }],
        refused: [{ tool: 'schedule_continuation', reason: 'runAt must be in the future' }],
      };

      await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      const expected: Partial<TraceView> = {
        status: 'completed',
        reason: null,
        deferredUntil: null,
        init: AN_OBSERVATION.init,
        toolCalls: AN_OBSERVATION.toolCalls,
        policyDecisions: [
          { source: 'app', tool: 'schedule_continuation', reason: 'runAt must be in the future' },
        ],
        model: A_REPORT.model,
        modelUsage: A_REPORT.modelUsage,
        numTurns: A_REPORT.numTurns,
        durationMs: A_REPORT.durationMs,
        terminalReason: 'completed',
        result: A_RESULT,
        runtimeEffects: [{ kind: 'delivery', id: 'outbox-1' }],
      };

      await expect(onlyTrace()).resolves.toMatchObject(expected);
      expect(effects.endings()).toEqual(['committed']);
    });

    /** A failure that reached the result message cost tokens too. */
    it('a failed run keeps both the error and the snapshots it reached', async () => {
      launcher.outcome = failed('error_max_turns', 'result');

      await expect(dispatcher.dispatch(request(EVENT, SYSTEM_STARTED))).resolves.toMatchObject({
        started: true,
        verdict: 'failed',
      });

      const expected: Partial<TraceView> = {
        status: 'failed',
        reason: 'error_max_turns',
        init: AN_OBSERVATION.init,
        model: A_REPORT.model,
        numTurns: A_REPORT.numTurns,
        result: null,
        runtimeEffects: [],
      };

      await expect(onlyTrace()).resolves.toMatchObject(expected);
      expect(effects.endings()).toEqual(['discarded']);
    });

    /**
     * A run that failed before init had no time to report: there is no snapshot at all, not an
     * empty one.
     */
    it('a failure with no report leaves no snapshot', async () => {
      launcher.outcome = failed('mcp server notion: needs-auth');

      await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      const expected: Partial<TraceView> = {
        status: 'failed',
        reason: 'mcp server notion: needs-auth',
        init: null,
        toolCalls: null,
        policyDecisions: null,
        model: null,
        modelUsage: null,
        numTurns: null,
        durationMs: null,
        result: null,
        runtimeEffects: [],
      };

      await expect(onlyTrace()).resolves.toMatchObject(expected);
      await expect(prisma.runSnapshot.count()).resolves.toBe(0);
    });

    /**
     * The verdict, the snapshot and the effects are one transaction. A snapshot the database
     * rejected must take the verdict with it: otherwise the row would become `completed` without
     * a snapshot, or the run would be counted by the breaker with a trace that does not exist.
     */
    it('a conclusion the database rejected leaves neither a verdict nor any part of the trace', async () => {
      const ticketId = await admitted(900);

      const broken: RunReport = {
        ...A_REPORT,
        modelUsage: {
          [A_REPORT.model]: { ...A_REPORT.modelUsage[A_REPORT.model], outputTokens: -1 },
        },
      };

      await expect(
        traces.conclude(ticketId, {
          status: 'completed',
          latencyMs: 100,
          report: broken,
          observation: AN_OBSERVATION,
          result: A_RESULT,
          effects: { applied: [{ kind: 'delivery', id: 'outbox-1' }], refused: [] },
        }),
      ).rejects.toThrow(/violates check constraint "run_model_usage_tokens"/);

      const row = await prisma.runTrace.findFirstOrThrow();

      expect(row.status).toBe('running');
      expect(row.finishedAt).toBeNull();
      await expect(
        Promise.all([prisma.runSnapshot.count(), prisma.runAppliedEffect.count()]),
      ).resolves.toEqual([0, 0]);
    });

    it('a run the person asked for is not counted against the budget', async () => {
      await dispatcher.dispatch(request(RECHECK, PERSON_ASKED));

      const trace = await prisma.runTrace.findFirstOrThrow();

      expect(trace.budgetClass).toBe('exempt');
      await expect(traces.countBudgetedSince(new Date(0))).resolves.toBe(0);
    });

    it('a denial creates no ledger row', async () => {
      await fillDay(prisma);

      const denied = await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(denied).toMatchObject({ started: false, denial: 'daily_limit' });
      await expect(prisma.runTrace.count()).resolves.toBe(budgetConfig().dailyLimit);
    });
  });

  describe('admission', () => {
    const occupySlot = (): Promise<unknown> =>
      prisma.runTrace.create({ data: runningRun(0, addMinutes(new Date(), 15)) });

    /**
     * The most important assertion of the suite: the room is held by a slot, and while a run
     * holds it, a second one does not get in.
     *
     * The hold is deterministic, not timer-based: otherwise the stub port returns instantly,
     * the critical section turns out empty, and the test would stay green even with no admission
     * at all.
     *
     * The barrier is armed **before** the run that needs to be caught inside. As a field
     * initializer it would resolve on the first launch of the first test in the file, and here
     * `await` would return immediately — that is, the assertion would rest on who gets there
     * first, not on the slot.
     */
    it('while a run holds the slot, a second one is not admitted', async () => {
      let release!: () => void;

      launcher.hold = new Promise<void>((resolve) => {
        release = resolve;
      });

      const entered = launcher.nextLaunch();
      const first = dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      await entered;

      // A barrier that is already resolved returns control before the run enters the port: then
      // the critical section is empty and the rest of the test checks nothing. This check
      // catches that breakage of the barrier.
      expect(launcher.launched).toHaveLength(1);

      const second = await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(second).toMatchObject({ started: false, denial: 'concurrency' });
      expect(launcher.launched).toHaveLength(1);

      release();

      await expect(first).resolves.toMatchObject({ started: true, verdict: 'completed' });
    });

    it('an occupied slot denies an exempt run too', async () => {
      await occupySlot();

      await expect(dispatcher.dispatch(request(RECHECK, PERSON_ASKED))).resolves.toMatchObject({
        started: false,
        denial: 'concurrency',
      });
    });

    /**
     * The reason a ticket has an expiry: otherwise a single `SIGKILL` would hold the concurrency
     * limit forever, and every following run would be denied.
     */
    it('the ticket of a killed process expires and the slot is given back', async () => {
      await prisma.runTrace.create({ data: runningRun(0, subSeconds(new Date(), 1)) });

      await expect(dispatcher.dispatch(request(EVENT, SYSTEM_STARTED))).resolves.toMatchObject({
        started: true,
      });

      const abandoned = await prisma.runTrace.findFirstOrThrow({ where: { status: 'abandoned' } });

      expect(abandoned.finishedAt).not.toBeNull();
      await expect(prisma.runTrace.count()).resolves.toBe(2);
    });

    /**
     * A zombie does not rewrite itself into `completed`.
     *
     * The ticket is revoked, the slot has already been given to another run — and the run comes
     * alive and reports success. Without a predicate on the status it would become `completed`,
     * and that would be enough to **close the circuit breaker**: it counts the completed runs.
     * One false win would disarm the breaker, which is the only thing standing between a broken
     * run path and forty spent runs a day.
     */
    it('the conclusion of a run whose ticket is revoked is written nowhere', async () => {
      const ticketId = await admitted(-1);

      await expect(traces.retireAbandoned()).resolves.toBe(1);

      await expect(
        traces.conclude(ticketId, {
          status: 'completed',
          latencyMs: 100,
          report: A_REPORT,
          observation: AN_OBSERVATION,
          result: A_RESULT,
          effects: { applied: [{ kind: 'delivery', id: 'outbox-1' }], refused: [] },
        }),
      ).resolves.toBe(false);
      await expect(
        traces.conclude(ticketId, {
          status: 'failed',
          latencyMs: 100,
          error: 'late',
          report: A_REPORT,
        }),
      ).resolves.toBe(false);

      const row = await prisma.runTrace.findFirstOrThrow();

      expect(row.status).toBe('abandoned');
      expect(row.reason).toBe('run never reported — ticket expired');
      // No part of the trace: the fence stands before the snapshot, not after it.
      await expect(
        Promise.all([prisma.runSnapshot.count(), prisma.runAppliedEffect.count()]),
      ).resolves.toEqual([0, 0]);
      // Most importantly, the breaker still sees neither a win nor a loss.
      await expect(traces.lastVerdicts(5)).resolves.toHaveLength(0);
    });

    /** An abandoned run is not a failure of the model, so the breaker does not see it. */
    it('abandoned runs do not open the circuit breaker', async () => {
      for (let index = 0; index < 5; index += 1) {
        await prisma.runTrace.create({ data: abandonedRun(index) });
      }

      await expect(gates.check(SYSTEM_STARTED)).resolves.toBeUndefined();
    });
  });

  describe('policy', () => {
    it('an exhausted daily limit does not stop a run the person asked for', async () => {
      await fillDay(prisma);

      await expect(gates.check(SYSTEM_STARTED)).resolves.toMatchObject({ denial: 'daily_limit' });
      await expect(gates.check(PERSON_ASKED)).resolves.toBeUndefined();
    });

    it('five consecutive failures open the breaker, four are not enough', async () => {
      await fillRuns(prisma, 4, failedRun);

      await expect(gates.check(SYSTEM_STARTED)).resolves.toBeUndefined();

      await prisma.runTrace.create({ data: failedRun(4) });

      await expect(gates.check(SYSTEM_STARTED)).resolves.toEqual({ denial: 'breaker' });
    });

    it('one success among the latest closes the breaker', async () => {
      await fillRuns(prisma, 5, failedRun);
      await prisma.runTrace.create({ data: completedRun(5) });

      await expect(gates.check(SYSTEM_STARTED)).resolves.toBeUndefined();
    });

    it('an open breaker does not stop a run the person asked for', async () => {
      await fillRuns(prisma, 5, failedRun);

      await expect(gates.check(PERSON_ASKED)).resolves.toBeUndefined();
    });
  });

  /**
   * The person learns about the breaker once per opening: five consecutive failures mean a broken
   * run path, and keeping quiet about it would mean silently not working.
   */
  describe('notice of an open breaker', () => {
    const lastFailed = async (): Promise<string> =>
      (
        await prisma.runTrace.findFirstOrThrow({
          where: { status: 'failed' },
          orderBy: { createdAt: 'desc' },
        })
      ).id;

    it('an opening yields one notice that names the last failed run', async () => {
      await fillRuns(prisma, 5, failedRun);

      await gates.state();
      await gates.state();

      expect(notice.told).toEqual([
        {
          lastFailedRunId: await lastFailed(),
          reason: 'mcp server notion: needs-auth',
          pageId: 'page-0',
          failures: 5,
        },
      ]);
    });

    it('four failures neither open the breaker nor trigger a notice', async () => {
      await fillRuns(prisma, 4, failedRun);

      await gates.state();

      expect(notice.told).toEqual([]);
    });

    it('the notice names the page the last run was about', async () => {
      await fillRuns(prisma, 4, failedRun);
      await prisma.runTrace.create({
        data: failedRun(4, {}, eventAbout('page-9', 'dialogue')),
      });

      await gates.state();

      expect(notice.told.map((opening) => opening.pageId)).toEqual(['page-9']);
    });

    /**
     * A queue failure does not change the run gates: the breaker denies autonomous runs even
     * without the notice.
     */
    it('a notice failure does not change the run gates and the next tick tries again', async () => {
      await fillRuns(prisma, 5, failedRun);
      notice.failures = 1;

      await expect(gates.state()).resolves.toMatchObject({ autonomous: { denial: 'breaker' } });
      expect(notice.told).toEqual([]);

      await gates.state();

      expect(notice.told).toHaveLength(1);
    });

    it('a new failure after the breaker closes is another opening and a new notice', async () => {
      await fillRuns(prisma, 5, failedRun);
      await gates.state();
      await prisma.runTrace.create({ data: completedRun(5) });
      await gates.state();
      await fillRuns(prisma, 5, (slot) => failedRun(slot + 6));
      await gates.state();

      expect(notice.told).toHaveLength(2);
      expect(new Set(notice.told.map((opening) => opening.lastFailedRunId)).size).toBe(2);
    });

    it('a breaker that did not open sends no notice, even after successful runs', async () => {
      await fillRuns(prisma, 5, completedRun);

      await gates.state();

      expect(notice.told).toEqual([]);
    });
  });

  /**
   * An exhausted plan quota is an external state, not a failure (ADR 0012). A run that hit it
   * leaves a record, but touches neither the daily limit nor the breaker; until the quota
   * resets, no run starts.
   */
  describe('plan quota', () => {
    const inTwoHours = (): Date => addHours(new Date(), 2);
    const anHourAgo = (): Date => subHours(new Date(), 1);

    it('a deferred run is recorded in the ledger with the reset time and spends no limit', async () => {
      const resetsAt = inTwoHours();

      launcher.outcome = deferred(resetsAt);

      const result = await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(result).toEqual({
        started: true,
        traceId: expect.any(String),
        verdict: 'plan_quota',
        notionReached: true,
      });

      const expected: Partial<TraceView> = {
        status: 'deferred',
        deferredUntil: resetsAt,
        budgetClass: 'budgeted',
        reason: 'plan limit reached',
        runtimeEffects: [],
      };

      await expect(onlyTrace()).resolves.toMatchObject(expected);
      await expect(traces.countBudgetedSince(new Date(0))).resolves.toBe(0);
      expect(effects.endings()).toEqual(['discarded']);
    });

    it('until the quota resets not even a run the person asked for starts', async () => {
      const until = inTwoHours();

      await prisma.runTrace.create({ data: deferredRun(0, until) });

      const expected: ClosedGate = { denial: 'plan_quota', until };

      await expect(gates.check(PERSON_ASKED)).resolves.toEqual(expected);
      await expect(dispatcher.dispatch(request(RECHECK, PERSON_ASKED))).resolves.toEqual({
        started: false,
        denial: 'plan_quota',
      });
      expect(launcher.launched).toHaveLength(0);
    });

    it('a reset quota stops no one', async () => {
      await prisma.runTrace.create({ data: deferredRun(0, anHourAgo()) });

      await expect(gates.check(SYSTEM_STARTED)).resolves.toBeUndefined();
    });

    /**
     * Forty deferrals in a day are not forty runs: a run spends the allowance, hitting the quota
     * does not.
     */
    it('deferred runs do not exhaust the daily limit', async () => {
      await fillDay(prisma, (slot) => deferredRun(slot, anHourAgo()));

      await expect(gates.check(SYSTEM_STARTED)).resolves.toBeUndefined();
    });

    /**
     * The breaker asks whether the next run will fail. An exhausted quota says nothing about
     * that: it neither opens the breaker nor closes an open one.
     */
    it('a deferred run neither opens nor closes the breaker', async () => {
      await fillRuns(prisma, 4, failedRun);
      await prisma.runTrace.create({ data: deferredRun(4, anHourAgo()) });

      await expect(gates.check(SYSTEM_STARTED)).resolves.toBeUndefined();

      await prisma.runTrace.create({ data: failedRun(5) });
      await prisma.runTrace.create({ data: deferredRun(6, anHourAgo()) });

      await expect(gates.check(SYSTEM_STARTED)).resolves.toEqual({ denial: 'breaker' });
    });
  });

  /**
   * A run that did not reach Notion waits through its row, not through the run gates (ADR 0045).
   */
  describe('Notion unavailable', () => {
    it('the deferral is recorded in the ledger with no deferral time and does not close the run gates', async () => {
      launcher.outcome = unreachable();

      await expect(dispatcher.dispatch(request(EVENT, SYSTEM_STARTED))).resolves.toEqual({
        started: true,
        traceId: expect.any(String),
        verdict: 'notion',
        notionReached: false,
      });

      const expected: Partial<TraceView> = {
        status: 'deferred',
        deferredUntil: null,
        reason: 'no Notion read succeeded',
      };

      await expect(onlyTrace()).resolves.toMatchObject(expected);
      await expect(traces.quotaBlockedUntil()).resolves.toBeNull();
      await expect(gates.check(PERSON_ASKED)).resolves.toBeUndefined();
      expect(effects.endings()).toEqual(['discarded']);
    });

    /**
     * What is broken is not the run path but an external state: that is not what the breaker asks
     * about.
     */
    it('snooze failures caused by an unavailable Notion do not open the breaker', async () => {
      await fillRuns(prisma, 5, (slot) => failedRun(slot, { notionUnavailable: true }));

      await expect(gates.check(SYSTEM_STARTED)).resolves.toBeUndefined();
      await expect(traces.lastVerdicts(5)).resolves.toHaveLength(0);
    });

    /**
     * A deferral that reached the model has already used up plan quota: a Notion outage does not
     * swallow it silently.
     */
    it('the daily limit counts deferrals that reached the model and does not count the rest', async () => {
      await prisma.runTrace.create({
        data: notionDeferredRun(0, withSnapshot(INIT_PART, REPORT_PART)),
      });
      await prisma.runTrace.create({ data: notionDeferredRun(1, withSnapshot(INIT_PART)) });
      await prisma.runTrace.create({ data: notionDeferredRun(2) });

      await expect(traces.countBudgetedSince(new Date(0))).resolves.toBe(1);
    });
  });

  describe('missing runner', () => {
    beforeEach(() => {
      launcher.available = false;
    });

    /**
     * By construction, absence is neither a cost nor a failure: a success report would close
     * windows as processed, burn the budget on nothing, and the breaker would never open.
     */
    it('spends no budget, leaves no record and does not call the port', async () => {
      const result = await dispatcher.dispatch(request(EVENT, SYSTEM_STARTED));

      expect(result).toMatchObject({ started: false, denial: 'runner_absent' });
      expect(launcher.launched).toHaveLength(0);
      await expect(prisma.runTrace.count()).resolves.toBe(0);
    });
  });

  /**
   * A runner that is present but has no live Notion MCP grant cannot run: this is a denial ahead
   * of the budget and admission, not a failure that would spend the limit and an attempt
   * (`INV-309`).
   */
  describe('unready runner', () => {
    beforeEach(() => {
      launcher.ready = { ready: false, reason: 'Notion MCP is not authorized' };
    });

    it('denies before admission, for a run the person asked for too', async () => {
      const result = await dispatcher.dispatch(request(RECHECK, PERSON_ASKED));

      expect(result).toEqual({ started: false, denial: 'runner_not_ready' });
      expect(order).toEqual([]);
      expect(launcher.launched).toHaveLength(0);
      await expect(prisma.runTrace.count()).resolves.toBe(0);
    });
  });

  /** The state of the run gates: what the scheduler sees before taking a row. */
  describe('run gate state', () => {
    it('free slots are the concurrency limit minus live tickets', async () => {
      const open: GateState = { autonomous: undefined, freeSlots: 1 };

      await expect(gates.state()).resolves.toEqual(open);

      await prisma.runTrace.create({ data: runningRun(0, addMinutes(new Date(), 15)) });

      await expect(gates.state()).resolves.toMatchObject({ freeSlots: 0 });
    });

    it('an expired ticket does not hold a slot', async () => {
      await prisma.runTrace.create({ data: runningRun(0, subSeconds(new Date(), 1)) });

      await expect(gates.state()).resolves.toMatchObject({ freeSlots: 1 });
    });

    it('the daily limit closes autonomous work until the next local day', async () => {
      await fillDay(prisma);

      const state = await gates.state();

      expect(state.all).toBeUndefined();
      expect(state.autonomous?.denial).toBe('daily_limit');
      expectStartOfNextLocalDay(state.autonomous?.until ?? new Date(0));
    });

    it('closed to everyone: slots and the autonomous run gates are not asked', async () => {
      launcher.available = false;

      const closed: GateState = {
        all: { denial: 'runner_absent', detail: 'no runner is wired' },
        freeSlots: 0,
      };

      await expect(gates.state()).resolves.toEqual(closed);
    });
  });

  it('a run that fails with an exception leaves a failure in the ledger', async () => {
    const exploding: RunLauncher = {
      available: true,
      readiness: () => Promise.resolve({ ready: true }),
      launch: () => Promise.reject(new Error('subprocess died')),
    };

    const isolated = await Test.createTestingModule({
      imports: [
        testConfig(
          databaseConfig,
          appConfig,
          budgetConfig,
          runsConfig,
          evaluationWindowConfig,
          workersConfig,
        ),
      ],
      providers: [
        PrismaService,
        RunTraceRepository,
        RunBudget,
        RunGates,
        { provide: BREAKER_NOTICE, useValue: notice },
        NOTION_WAIT_NOTICE_PROVIDER,
        RunDispatcher,
        { provide: RUN_LAUNCHER, useValue: exploding },
        { provide: RUN_EFFECTS, useValue: new RecordingEffects() },
      ],
    }).compile();

    await isolated.init();

    await expect(
      isolated.get(RunDispatcher).dispatch(request(EVENT, SYSTEM_STARTED)),
    ).rejects.toThrow('subprocess died');

    const expected: Partial<TraceView> = {
      status: 'failed',
      reason: 'subprocess died',
      model: null,
      runtimeEffects: [],
    };
    const trace = await onlyTrace();

    expect(trace).toMatchObject(expected);
    expect(trace.finishedAt).not.toBeNull();

    await isolated.close();
  });
});
