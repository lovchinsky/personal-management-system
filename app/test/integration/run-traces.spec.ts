import { Test, TestingModule } from '@nestjs/testing';
import { addHours } from 'date-fns';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { EffectsReport } from '../../src/runs/run-effects';
import { RunObservation, RunReport, ToolCall } from '../../src/runs/run-outcome';
import { Conclusion, RunTraceRepository } from '../../src/runs/run-trace.repository';
import { RunTraces, TraceView } from '../../src/runs/run-traces';
import {
  closureEnvelope,
  eventEnvelope,
  recheckEnvelope,
  reviewEnvelope,
  TriggerEnvelope,
} from '../../src/runs/trigger-envelope';
import { A_REPORT, A_RESULT, AN_OBSERVATION } from '../fixtures/run-outcome.fixture';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

/**
 * A trace written by the conclusion is read back as exactly what was written.
 *
 * Between the two are tables: the snapshot and the lists as rows. This checks that the round
 * trip loses nothing and invents nothing: the order of the lists, a field that was not there,
 * and the difference between “not recorded” (`null`) and “recorded as empty” (`[]`), which the
 * view takes from the part that writes the list, not from the presence of rows. The comparison
 * is exact, not by subset: an extra field in the view is a discrepancy too.
 */
const EVENT = eventEnvelope('event_evaluation', {
  type: 'page.properties_updated',
  event_types: ['page.properties_updated'],
  event_id: 'evt-1',
  timestamp: new Date().toISOString(),
  entity_id: 'page-1',
  page_id: 'page-1',
  updated_property_ids: [],
});

/** Twelve calls: an order that rested on the position as text would break at the tenth. */
const MANY_CALLS: readonly ToolCall[] = Array.from({ length: 12 }, (_, index) =>
  index % 3 === 2
    ? { tool: 'StructuredOutput', ok: index !== 11 }
    : { server: index % 3 === 0 ? 'notion' : 'gbrain', tool: `tool-${index}`, ok: true },
);

const OBSERVED: RunObservation = {
  ...AN_OBSERVATION,
  toolCalls: MANY_CALLS,
  permissionDenials: ['mcp__notion__notion-create-pages', 'Bash'],
};

/** Two models: the profile's, with its canonical name, and an auxiliary one without it. */
const TWO_MODELS: RunReport = {
  ...A_REPORT,
  modelUsage: {
    ...A_REPORT.modelUsage,
    'claude-haiku-4-5': {
      inputTokens: 1_032,
      outputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  },
};

const EFFECTS: EffectsReport = {
  applied: [
    { kind: 'continuation', id: 'check-1' },
    { kind: 'proposal', id: 'action-1' },
    { kind: 'delivery', id: 'outbox-1' },
  ],
  refused: [{ tool: 'queue_notification', reason: 'quiet hours are not yours to skip' }],
};

describe('run trace: conclusion and view', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let traces: RunTraceRepository;
  let views: RunTraces;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig)],
      providers: [PrismaService, RunTraceRepository, RunTraces],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    traces = moduleRef.get(RunTraceRepository);
    views = moduleRef.get(RunTraces);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function admitted(ticketSeconds = 900): Promise<string> {
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

  async function concluded(conclusion: Conclusion): Promise<TraceView | null> {
    const id = await admitted();

    await expect(traces.conclude(id, conclusion)).resolves.toBe(true);

    return views.find(id);
  }

  it('a completed run reads back as what was written, in the same order', async () => {
    const expected: Partial<TraceView> = {
      status: 'completed',
      reason: null,
      init: OBSERVED.init,
      toolCalls: MANY_CALLS,
      policyDecisions: [
        { source: 'perimeter', tool: 'mcp__notion__notion-create-pages' },
        { source: 'perimeter', tool: 'Bash' },
        { source: 'app', tool: 'queue_notification', reason: 'quiet hours are not yours to skip' },
      ],
      model: TWO_MODELS.model,
      modelUsage: TWO_MODELS.modelUsage,
      numTurns: TWO_MODELS.numTurns,
      durationMs: TWO_MODELS.durationMs,
      terminalReason: TWO_MODELS.terminalReason,
      result: A_RESULT,
      runtimeEffects: EFFECTS.applied,
    };

    await expect(
      concluded({
        status: 'completed',
        latencyMs: 20_000,
        report: TWO_MODELS,
        observation: OBSERVED,
        result: A_RESULT,
        effects: EFFECTS,
      }),
    ).resolves.toEqual(expect.objectContaining(expected));
  });

  /** Applying is not atomic: the applied prefix stays and goes into the trace of the failed run. */
  it('a failure after part of the effects were applied leaves the applied prefix', async () => {
    const expected: Partial<TraceView> = {
      status: 'failed',
      reason: 'App effects not applied: snooze held',
      result: A_RESULT,
      runtimeEffects: [{ kind: 'continuation', id: 'check-1' }],
    };

    await expect(
      concluded({
        status: 'failed',
        latencyMs: 20_000,
        error: 'App effects not applied: snooze held',
        report: A_REPORT,
        observation: AN_OBSERVATION,
        result: A_RESULT,
        effects: { applied: [{ kind: 'continuation', id: 'check-1' }], refused: [], failure: 'x' },
      }),
    ).resolves.toEqual(expect.objectContaining(expected));
  });

  /**
   * A run that failed before init has no snapshot. It applied no effects — this is recorded
   * as an empty list, even when the App session never opened.
   */
  it.each([
    ['session closed without writes', { applied: [], refused: [] }],
    ['no session', undefined],
  ])('failure before init: no snapshot, effects empty (%s)', async (_, effects) => {
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
      terminalReason: null,
      result: null,
      runtimeEffects: [],
    };

    await expect(
      concluded({
        status: 'failed',
        latencyMs: 1_000,
        error: 'mcp server notion: needs-auth',
        effects,
      }),
    ).resolves.toEqual(expect.objectContaining(expected));
  });

  /**
   * An unavailable model: there is a result message, but no init and no calls. The model is
   * `none`, the tokens are empty, and that means “there were none”, not “not recorded”.
   */
  it('a report without init: calls not recorded, tokens recorded as empty', async () => {
    const unavailable: RunReport = {
      model: 'none',
      modelUsage: {},
      numTurns: 1,
      durationMs: 3_700,
    };
    const expected: Partial<TraceView> = {
      status: 'failed',
      init: null,
      toolCalls: null,
      policyDecisions: null,
      model: 'none',
      modelUsage: {},
      terminalReason: null,
      result: null,
    };

    await expect(
      concluded({
        status: 'failed',
        latencyMs: 8_900,
        error: 'the run ended with api_error (subtype success, is_error)',
        report: unavailable,
        effects: { applied: [], refused: [] },
      }),
    ).resolves.toEqual(expect.objectContaining(expected));
  });

  it('a deferred run has the reason, the reset time and the snapshots it reached', async () => {
    const until = addHours(new Date(), 1);
    const expected: Partial<TraceView> = {
      status: 'deferred',
      reason: 'plan limit reached',
      deferredUntil: until,
      init: AN_OBSERVATION.init,
      toolCalls: AN_OBSERVATION.toolCalls,
      policyDecisions: [],
      model: A_REPORT.model,
      result: null,
      runtimeEffects: [],
    };

    await expect(
      concluded({
        status: 'deferred',
        cause: 'plan_quota',
        latencyMs: 5_000,
        reason: 'plan limit reached',
        until,
        report: A_REPORT,
        observation: AN_OBSERVATION,
        effects: { applied: [], refused: [] },
      }),
    ).resolves.toEqual(expect.objectContaining(expected));
  });

  /**
   * A run that did not reach a conclusion reported nothing — and the view does not pretend a list
   * is empty.
   */
  it.each([
    ['unfinished', 900, 'running'],
    ['abandoned', -1, 'abandoned'],
  ])('%s run: no list is recorded', async (_, ticketSeconds, status) => {
    const id = await admitted(ticketSeconds);

    await traces.retireAbandoned();

    await expect(views.find(id)).resolves.toEqual(
      expect.objectContaining({
        status,
        init: null,
        toolCalls: null,
        policyDecisions: null,
        modelUsage: null,
        result: null,
        runtimeEffects: null,
      }),
    );
  });

  it('the view does not invent a run that does not exist', async () => {
    await expect(views.find('no-such-run')).resolves.toBeNull();
  });
});

/**
 * The page of a run is written by admission from the envelope, and looked up by the sweep (has a
 * run seen the situation) and the breaker (the page of the failure). The writer and the readers
 * are checked against each other here on every envelope builder — without rows put together by
 * hand.
 */
describe('run page: from admission to readers', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let traces: RunTraceRepository;
  let views: RunTraces;

  const SINCE = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig)],
      providers: [PrismaService, RunTraceRepository, RunTraces],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    traces = moduleRef.get(RunTraceRepository);
    views = moduleRef.get(RunTraces);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function ran(envelope: TriggerEnvelope, completed = true): Promise<void> {
    const ticket = await traces.admit({
      envelope,
      origin: 'evaluation_window',
      budgetClass: 'budgeted',
      concurrency: 1,
      ticketSeconds: 900,
    });

    if (!ticket) throw new Error('the only slot was taken in an empty ledger');

    await traces.conclude(
      ticket.id,
      completed
        ? {
            status: 'completed',
            latencyMs: 1_000,
            report: A_REPORT,
            observation: AN_OBSERVATION,
            result: A_RESULT,
            effects: { applied: [], refused: [] },
          }
        : {
            status: 'failed',
            latencyMs: 1_000,
            error: 'the run failed',
            report: A_REPORT,
            effects: { applied: [], refused: [] },
          },
    );
  }

  it.each([
    [
      'event',
      eventEnvelope('event_evaluation', {
        type: 'page.properties_updated',
        event_types: ['page.properties_updated'],
        event_id: 'evt-e',
        timestamp: '2026-10-17T05:30:00.000Z',
        entity_id: 'page-e',
        page_id: 'page-e',
        updated_property_ids: [],
      }),
    ],
    [
      'recheck',
      recheckEnvelope({ event_id: 'check-1:1', reason_code: 'safety_recheck', page_id: 'page-e' }),
    ],
    [
      'closure',
      closureEnvelope({
        event_id: 'check-2:1',
        reason_code: 'resolution_reconciliation',
        page_id: 'page-e',
      }),
    ],
  ])('%s: a run about a page is found by that page', async (_, envelope) => {
    await ran(envelope);

    await expect(views.concludedAbout(['page-e'], SINCE)).resolves.toBe(true);
    await expect(views.concludedAbout(['page-other'], SINCE)).resolves.toBe(false);
  });

  it('a review has no page and is not found by page', async () => {
    await ran(
      reviewEnvelope('daily_control', {
        event_id: 'review:daily_control:2026-10-17',
        timestamp: '2026-10-17T05:30:00.000Z',
        since: '2026-10-16T05:30:00.000Z',
      }),
    );

    await expect(traces.lastFinished()).resolves.toMatchObject({ pageId: null });
  });

  it('the breaker sees the page of the last failed run', async () => {
    await ran(
      recheckEnvelope({
        event_id: 'check-3:1',
        reason_code: 'safety_recheck',
        page_id: 'page-failed',
      }),
      false,
    );

    await expect(traces.lastFinished()).resolves.toMatchObject({ pageId: 'page-failed' });
  });
});
