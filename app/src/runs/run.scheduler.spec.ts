import { Test } from '@nestjs/testing';
import { workersConfig, type WorkersConfig } from '../platform/worker/workers.config';
import { Disposition } from './disposition';
import { ScheduledProvenance } from './provenance';
import { GateState, RunGates } from './run-gates';
import { ClaimedRun, RUN_SOURCES, RunCandidate, RunSource } from './run-source';
import { DispatchRequest, DispatchResult, RunDispatcher } from './run.dispatcher';
import { RunScheduler } from './run.scheduler';
import { runsConfig, type RunsConfig } from './runs.config';
import { recheckEnvelope } from './trigger-envelope';

const at = (minutes: number): Date => new Date(Date.UTC(2026, 8, 29, 9, minutes));

const SNOOZE: ScheduledProvenance = { origin: 'scheduled_check', reasonCode: 'user_snooze' };
const WINDOW: ScheduledProvenance = { origin: 'evaluation_window' };

const OPEN: GateState = { freeSlots: 1 };

const RUNS: RunsConfig = runsConfig();

/** The run reached Notion: the disposition log shows it (ADR 0045). */
const reach = (notionReached: boolean): string => (notionReached ? ', notion reached' : '');

/** The loop does not start here: the test drives the ticks itself. */
const WORKERS: WorkersConfig = { enabled: false };

/** A row of a source as the test describes it: what the scheduler sees in a candidate. */
type Row = Omit<RunCandidate, 'claim'>;

/**
 * A source that records what happened: the claim and every disposition of a row. `gone` holds rows
 * that can no longer be taken; `broken` holds rows whose claim fails.
 */
class RecordingSource implements RunSource {
  readonly log: string[] = [];
  readonly gone = new Set<string>();
  readonly broken = new Set<string>();
  concluding: Disposition = 'closed';

  constructor(private readonly rows: readonly Row[]) {}

  retire(): Promise<void> {
    this.log.push('retire');

    return Promise.resolve();
  }

  candidates(): Promise<RunCandidate[]> {
    return Promise.resolve(this.rows.map((row) => ({ ...row, claim: () => this.claim(row) })));
  }

  /** Pruning is not the scheduler's concern. */
  pruneConcluded(): Promise<number> {
    return Promise.resolve(0);
  }

  /** How many rows releasing the Notion hold lets go; `null` means the release fails. */
  releasing: number | null = 0;
  /** The prior release the scheduler passed with each request to release the hold. */
  readonly releasedAfter: (Date | undefined)[] = [];

  releaseNotionHolds(previous?: Date): Promise<number> {
    this.log.push('release notion holds');
    this.releasedAfter.push(previous);

    return this.releasing === null
      ? Promise.reject(new Error('release failed'))
      : Promise.resolve(this.releasing);
  }

  private claim(row: Row): Promise<ClaimedRun | null> {
    const { id } = row;
    if (this.gone.has(id)) {
      return Promise.resolve(null);
    }
    if (this.broken.has(id)) {
      return Promise.reject(new Error(`${id} could not be claimed`));
    }

    this.log.push(`claim ${id}`);

    const step = (name: string): Promise<boolean> => {
      this.log.push(`${name} ${id}`);

      return Promise.resolve(true);
    };

    return Promise.resolve({
      id,
      request: {
        envelope: recheckEnvelope({
          event_id: `check-${id}:0`,
          page_id: `page-${id}`,
          reason_code: 'user_snooze',
        }),
        provenance: row.provenance,
        originId: id,
      },
      recordAttempt: () => step('attempt'),
      conclude: (notionReached) => {
        this.log.push(`conclude ${id}${reach(notionReached)}`);

        return Promise.resolve(this.concluding);
      },
      release: () => step('release'),
      fail: (error, notionReached) => step(`fail(${error}${reach(notionReached)})`),
      refund: (reason, notionReached) => step(`refund(${reason}${reach(notionReached)})`),
      waitForNotion: (reason) => step(`wait for notion(${reason})`),
    });
  }
}

/** A source with a single due snooze, the row the test controls. */
const single = (): RecordingSource =>
  new RecordingSource([{ id: 'c-1', provenance: SNOOZE, dueAt: at(0), retried: false }]);

interface Scheduling {
  readonly scheduler: RunScheduler;
  /** What reached the dispatcher: the id of each run's origin row. */
  readonly dispatched: string[];
}

async function schedulerOver(
  sources: readonly RunSource[],
  gates: GateState = OPEN,
  answer: (request: DispatchRequest) => Promise<DispatchResult> = async (request) => {
    await request.recordAttempt();

    return { started: true, traceId: 'run-1', verdict: 'completed', notionReached: false };
  },
): Promise<Scheduling> {
  const dispatched: string[] = [];
  const gatesOf: Pick<RunGates, 'state'> = { state: () => Promise.resolve(gates) };
  const dispatcher: Pick<RunDispatcher, 'dispatch'> = {
    dispatch: (request) => {
      dispatched.push(request.originId ?? '');

      return answer(request);
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      RunScheduler,
      { provide: RUN_SOURCES, useValue: sources },
      { provide: RunGates, useValue: gatesOf },
      { provide: RunDispatcher, useValue: dispatcher },
      { provide: runsConfig.KEY, useValue: RUNS },
      { provide: workersConfig.KEY, useValue: WORKERS },
    ],
  }).compile();

  return { scheduler: moduleRef.get(RunScheduler), dispatched };
}

describe('run scheduler', () => {
  /** The evaluation window came due earlier, but a person's snooze ranks higher by class. */
  it('takes the best candidate by run priority from all sources', async () => {
    const windows = new RecordingSource([
      { id: 'w-1', provenance: WINDOW, dueAt: at(0), retried: false },
    ]);
    const checks = new RecordingSource([
      { id: 'c-1', provenance: SNOOZE, dueAt: at(30), retried: false },
    ]);
    const { scheduler, dispatched } = await schedulerOver([windows, checks]);

    await expect(scheduler.runOnce()).resolves.toBe(1);

    expect(dispatched).toEqual(['c-1']);
    expect(windows.log).toEqual(['retire']);
    expect(checks.log).toEqual(['retire', 'claim c-1', 'attempt c-1', 'conclude c-1']);
  });

  /**
   * A claim failed in the middle of a tick: the rows the tick has already claimed are released
   * unchanged, because their runs have not started, and the error propagates.
   */
  it('a failed claim releases the rows the tick has already claimed', async () => {
    const checks = new RecordingSource([
      { id: 'c-1', provenance: SNOOZE, dueAt: at(0), retried: false },
      { id: 'c-2', provenance: SNOOZE, dueAt: at(1), retried: false },
    ]);

    checks.broken.add('c-2');

    const { scheduler, dispatched } = await schedulerOver([checks], { freeSlots: 2 });

    await expect(scheduler.runOnce()).rejects.toThrow('c-2 could not be claimed');

    expect(dispatched).toEqual([]);
    expect(checks.log).toEqual(['retire', 'claim c-1', 'release c-1']);
  });

  it('takes no more rows than there are free slots', async () => {
    const checks = new RecordingSource([
      { id: 'c-1', provenance: SNOOZE, dueAt: at(0), retried: false },
      { id: 'c-2', provenance: SNOOZE, dueAt: at(1), retried: false },
      { id: 'c-3', provenance: SNOOZE, dueAt: at(2), retried: false },
    ]);
    const { scheduler, dispatched } = await schedulerOver([checks], { freeSlots: 2 });

    await expect(scheduler.runOnce()).resolves.toBe(2);

    expect(dispatched).toEqual(['c-1', 'c-2']);
  });

  it('skips a row that can no longer be taken in favor of the next one', async () => {
    const checks = new RecordingSource([
      { id: 'c-1', provenance: SNOOZE, dueAt: at(0), retried: false },
      { id: 'c-2', provenance: SNOOZE, dueAt: at(1), retried: false },
    ]);

    checks.gone.add('c-1');

    const { scheduler, dispatched } = await schedulerOver([checks]);

    await scheduler.runOnce();

    expect(dispatched).toEqual(['c-2']);
  });

  describe('run gates', () => {
    const both = (): [RecordingSource, RecordingSource] => [
      new RecordingSource([{ id: 'w-1', provenance: WINDOW, dueAt: at(0), retried: false }]),
      new RecordingSource([{ id: 'c-1', provenance: SNOOZE, dueAt: at(30), retried: false }]),
    ];

    /** Run gates closed to all leave rows untouched: no claim, no disposition (`INV-084`). */
    it('when closed to all, no row is taken', async () => {
      const [windows, checks] = both();
      const { scheduler, dispatched } = await schedulerOver([windows, checks], {
        all: { denial: 'runner_not_ready', detail: 'Notion MCP is not authorized' },
        freeSlots: 0,
      });

      await expect(scheduler.runOnce()).resolves.toBe(0);

      expect(dispatched).toEqual([]);
      expect([...windows.log, ...checks.log]).toEqual(['retire', 'retire']);
    });

    it('without a free slot, no row is taken', async () => {
      const [windows, checks] = both();
      const { scheduler, dispatched } = await schedulerOver([windows, checks], { freeSlots: 0 });

      await expect(scheduler.runOnce()).resolves.toBe(0);

      expect(dispatched).toEqual([]);
    });

    /** The daily limit stops only autonomous work: a person's snooze still runs. */
    it('when closed to autonomous work, only exempt work is taken', async () => {
      const windows = new RecordingSource([
        { id: 'w-1', provenance: WINDOW, dueAt: at(0), retried: false },
      ]);
      const { scheduler, dispatched } = await schedulerOver([windows], {
        autonomous: { denial: 'daily_limit', until: at(60) },
        freeSlots: 1,
      });

      await expect(scheduler.runOnce()).resolves.toBe(0);

      expect(dispatched).toEqual([]);
      expect(windows.log).toEqual(['retire']);
    });
  });

  describe('the outcome of a run is applied to the row', () => {
    const cases: [string, DispatchResult, string][] = [
      [
        'a denial that finds a claimed row releases it unchanged',
        { started: false, denial: 'concurrency' },
        'release c-1',
      ],
      [
        'a failure releases the row with a reason',
        { started: true, traceId: 'run-1', verdict: 'failed', notionReached: false },
        'fail(run reported failure) c-1',
      ],
      [
        'the plan quota releases the row with the attempt refunded',
        { started: true, traceId: 'run-1', verdict: 'plan_quota', notionReached: false },
        'refund(run deferred: plan_quota) c-1',
      ],
      [
        'Notion not reached makes the row wait for Notion',
        { started: true, traceId: 'run-1', verdict: 'notion', notionReached: false },
        'wait for notion(run deferred: Notion was not reached) c-1',
      ],
    ];

    it.each(cases)('%s', async (_, result, disposition) => {
      const checks = single();
      const { scheduler } = await schedulerOver([checks], OPEN, () => Promise.resolve(result));

      await scheduler.runOnce();

      expect(checks.log).toEqual(['retire', 'claim c-1', disposition]);
    });

    /**
     * The error is not lost: the worker loop logs it, and the row has already gone back with a
     * reason.
     */
    it('a run that throws releases the row with a reason and passes the error on', async () => {
      const checks = single();
      const { scheduler } = await schedulerOver([checks], OPEN, () =>
        Promise.reject(new Error('admission failed')),
      );

      await expect(scheduler.runOnce()).rejects.toThrow('admission failed');
      expect(checks.log).toEqual(['retire', 'claim c-1', 'fail(admission failed) c-1']);
    });

    it('a row changed during the run stays in the queue', async () => {
      const checks = single();

      checks.concluding = 'superseded';

      const { scheduler } = await schedulerOver([checks]);

      await expect(scheduler.runOnce()).resolves.toBe(1);
      expect(checks.log).toEqual(['retire', 'claim c-1', 'attempt c-1', 'conclude c-1']);
    });
  });

  /**
   * A run that reached Notion clears the pauses of the rows that were waiting for Notion and ends
   * the consecutive wait of its own row (ADR 0045).
   */
  describe('Notion answers again', () => {
    const reached = (verdict: 'completed' | 'failed' | 'plan_quota'): DispatchResult => ({
      started: true,
      traceId: 'run-1',
      verdict,
      notionReached: true,
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const cases: [string, DispatchResult, string][] = [
      ['concluding the row', reached('completed'), 'conclude c-1, notion reached'],
      ['failing the row', reached('failed'), 'fail(run reported failure, notion reached) c-1'],
      [
        'the plan quota',
        reached('plan_quota'),
        'refund(run deferred: plan_quota, notion reached) c-1',
      ],
    ];

    /**
     * The pauses are cleared after the disposition, in the same tick: the next tick no longer sees
     * them.
     */
    it.each(cases)(
      '%s: the pauses of all rows are cleared, and the row of the run no longer waits',
      async (_, result, disposition) => {
        const checks = new RecordingSource([
          { id: 'c-1', provenance: SNOOZE, dueAt: at(0), retried: false },
        ]);
        const windows = new RecordingSource([]);
        const { scheduler } = await schedulerOver([checks, windows], OPEN, () =>
          Promise.resolve(result),
        );

        await scheduler.runOnce();

        expect(checks.log).toEqual(['retire', 'claim c-1', disposition, 'release notion holds']);
        expect(windows.log).toEqual(['retire', 'release notion holds']);
      },
    );

    const silent: [string, DispatchResult][] = [
      ['a run that did not start', { started: false, denial: 'concurrency' }],
      [
        'a run that did not reach Notion',
        { started: true, traceId: 'run-1', verdict: 'notion', notionReached: false },
      ],
    ];

    it.each(silent)('%s clears no pauses', async (_, result) => {
      const checks = new RecordingSource([
        { id: 'c-1', provenance: SNOOZE, dueAt: at(0), retried: false },
      ]);
      const { scheduler } = await schedulerOver([checks], OPEN, () => Promise.resolve(result));

      await scheduler.runOnce();

      expect(checks.log).not.toContain('release notion holds');
    });

    /**
     * A failure to clear the pauses does not leave a row whose run has already happened under a
     * lease.
     */
    it("a failed release comes after the row's disposition, and the error propagates", async () => {
      const checks = single();

      checks.releasing = null;

      const { scheduler } = await schedulerOver([checks], OPEN, () =>
        Promise.resolve(reached('completed')),
      );

      await expect(scheduler.runOnce()).rejects.toThrow('release failed');
      expect(checks.log).toEqual([
        'retire',
        'claim c-1',
        'conclude c-1, notion reached',
        'release notion holds',
      ]);
    });

    /**
     * A row that was waiting at the prior release too again did not reach Notion while Notion was
     * answering others: it is not released a second time, and an immediate retry on every success
     * of another row does not bypass its pause. A release that let no one go does not move the
     * cutoff.
     */
    it('each release passes the prior release that let someone go', async () => {
      jest.useFakeTimers({ now: at(0), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

      const checks = single();
      const { scheduler } = await schedulerOver([checks], OPEN, () =>
        Promise.resolve(reached('failed')),
      );

      await scheduler.runOnce();
      checks.releasing = 2;
      jest.setSystemTime(at(5));
      await scheduler.runOnce();
      checks.releasing = 0;
      jest.setSystemTime(at(10));
      await scheduler.runOnce();
      jest.setSystemTime(at(15));
      await scheduler.runOnce();

      expect(checks.releasedAfter).toEqual([undefined, undefined, at(5), at(5)]);
    });
  });
});
