import { Test } from '@nestjs/testing';
import { addSeconds, secondsToMilliseconds } from 'date-fns';
import { profileFor } from '../../src/claude/run-profile';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { budgetConfig } from '../../src/runs/budget.config';
import { RUN_EFFECTS } from '../../src/runs/run-effects';
import { RunGates } from '../../src/runs/run-gates';
import { RunOutcome } from '../../src/runs/run-outcome';
import { Admission, RunTraceRepository, Ticket } from '../../src/runs/run-trace.repository';
import { DispatchRequest, RunDispatcher } from '../../src/runs/run.dispatcher';
import { AdmittedRun, RUN_LAUNCHER, RunLauncher } from '../../src/runs/run.launcher';
import { runsConfig } from '../../src/runs/runs.config';
import { eventEnvelope } from '../../src/runs/trigger-envelope';
import { NOTION_WAIT_NOTICE_PROVIDER } from '../fixtures/notion-wait-notice';
import { RecordingEffects } from '../fixtures/recording-effects';
import { testConfig } from '../fixtures/test-module';

const { ticketSeconds: TICKET_SECONDS } = runsConfig();
const { concurrency: CONCURRENCY } = budgetConfig();

const REQUEST: DispatchRequest = {
  envelope: eventEnvelope('event_evaluation', {
    type: 'page.properties_updated',
    event_types: ['page.properties_updated'],
    event_id: 'evt-1',
    timestamp: '2026-09-28T10:00:00.000Z',
    entity_id: 'page-1',
    page_id: 'page-1',
    updated_property_ids: [],
  }),
  provenance: { origin: 'evaluation_window' },
  recordAttempt: () => Promise.resolve(),
};

function admitted(): Ticket {
  return { id: 'run-1', expiresAt: addSeconds(new Date(), TICKET_SECONDS) };
}

/** Creates a dispatcher over a ledger whose admission the test decides. */
async function dispatcherWith(
  launcher: RunLauncher,
  admit: (admission: Admission) => Promise<Ticket | null>,
): Promise<RunDispatcher> {
  const traces: Pick<RunTraceRepository, 'admit' | 'conclude'> = {
    admit,
    conclude: () => Promise.resolve(true),
  };
  const gates: Pick<RunGates, 'check'> = { check: () => Promise.resolve(undefined) };

  const moduleRef = await Test.createTestingModule({
    imports: [testConfig(budgetConfig, runsConfig)],
    providers: [
      RunDispatcher,
      { provide: RunGates, useValue: gates },
      { provide: RunTraceRepository, useValue: traces },
      { provide: RUN_LAUNCHER, useValue: launcher },
      { provide: RUN_EFFECTS, useValue: new RecordingEffects() },
      NOTION_WAIT_NOTICE_PROVIDER,
    ],
  }).compile();

  return moduleRef.get(RunDispatcher);
}

/**
 * `INV-304`: `query()` spawns a subprocess per run and has no upper session timeout, so the App
 * enforces the bound through four mechanisms: its own queue with limited concurrency, `maxTurns`,
 * `maxBudgetUsd` and its own `AbortController`.
 *
 * This file covers what the App enforces itself, regardless of how many triggers arrive at once:
 * the number of concurrent runs is a parameter, not a consequence; every profile limits the turns
 * and the cost; every run gets an abort signal.
 */
describe('INV-304', () => {
  it('the number of concurrent runs is what the parameter says, and admission asks for that parameter', async () => {
    const asked: number[] = [];
    const runs: AdmittedRun[] = [];
    const launcher: RunLauncher = {
      available: true,
      readiness: () => Promise.resolve({ ready: true }),
      launch: (run) => {
        runs.push(run);

        return Promise.resolve<RunOutcome>({ status: 'failed', error: 'launched' });
      },
    };
    const dispatcher = await dispatcherWith(launcher, (admission) => {
      asked.push(admission.concurrency);

      return Promise.resolve(null);
    });

    await expect(dispatcher.dispatch(REQUEST)).resolves.toMatchObject({
      started: false,
      denial: 'concurrency',
    });
    expect(Number.isInteger(CONCURRENCY) && CONCURRENCY >= 1).toBe(true);
    expect(asked).toEqual([CONCURRENCY]);
    expect(runs).toHaveLength(0);
  });

  /** An App-triggered run occurs in every mode, so every mode needs a profile. */
  it.each(Object.values(WorkflowMode))('the %s profile limits both turns and cost', (mode) => {
    const { maxTurns, maxBudgetUsd } = profileFor(mode);

    expect(Number.isInteger(maxTurns) && maxTurns >= 1).toBe(true);
    expect(Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0).toBe(true);
  });

  it('every run gets an abort signal that fires before the ticket expires', async () => {
    jest.useFakeTimers();

    const signals: AbortSignal[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const launcher: RunLauncher = {
      available: true,
      readiness: () => Promise.resolve({ ready: true }),
      launch: async (run) => {
        signals.push(run.signal);
        await held;

        return { status: 'failed', error: 'released' };
      },
    };
    const dispatcher = await dispatcherWith(launcher, () => Promise.resolve(admitted()));

    const dispatched = dispatcher.dispatch(REQUEST);

    await jest.advanceTimersByTimeAsync(secondsToMilliseconds(TICKET_SECONDS) - 1);

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);

    release();
    await dispatched;
    jest.useRealTimers();
  });
});
