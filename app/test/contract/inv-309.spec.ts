import { Test } from '@nestjs/testing';
import { subDays } from 'date-fns';
import { CLAUDE_QUERY } from '../../src/claude/runner/claude-query';
import { ClaudeRunner } from '../../src/claude/runner/claude-runner';
import { PLUGIN_DIGEST } from '../../src/claude/runner/plugin-digest';
import { runnerConfig, type RunnerConfig } from '../../src/claude/runner/runner.config';
import { appConfig, type AppConfig } from '../../src/config/app.config';
import {
  ConnectorCredentialRepository,
  GrantMoments,
} from '../../src/credentials/connector-credential.repository';
import { GbrainToken } from '../../src/credentials/gbrain/gbrain.token';
import { NotionMcpGrant } from '../../src/credentials/notion-mcp/notion-mcp.grant';
import { NotionMcpOAuth } from '../../src/credentials/notion-mcp/notion-mcp.oauth';
import { budgetConfig, type BudgetConfig } from '../../src/runs/budget.config';
import { RunBudget } from '../../src/runs/run-budget';
import { RUN_EFFECTS } from '../../src/runs/run-effects';
import { RunGates } from '../../src/runs/run-gates';
import { RunTraceRepository } from '../../src/runs/run-trace.repository';
import { DispatchRequest, DispatchResult, RunDispatcher } from '../../src/runs/run.dispatcher';
import { RUN_LAUNCHER } from '../../src/runs/run.launcher';
import { runsConfig } from '../../src/runs/runs.config';
import { recheckEnvelope } from '../../src/runs/trigger-envelope';
import { BREAKER_NOTICE_PROVIDER } from '../fixtures/breaker-notice';
import { NOTION_WAIT_NOTICE_PROVIDER } from '../fixtures/notion-wait-notice';
import { RecordingEffects } from '../fixtures/recording-effects';
import { testConfig, unreached } from '../fixtures/test-module';

const APP: AppConfig = {
  port: 3000,
  timeZone: 'Europe/Kyiv',
  language: 'uk',
  ownerGender: 'neutral',
};

const BUDGET: BudgetConfig = { ...budgetConfig(), concurrency: 1 };

/**
 * The runner is enabled: otherwise the dispatcher would not reach the grant. There is no run here,
 * so the rest of the runner's settings are not needed.
 */
const RUNNER: RunnerConfig = {
  enabled: true,
  oauthToken: undefined,
  pluginDir: undefined,
  gbrainMcpUrl: undefined,
  path: undefined,
};

/** What happened before the denial. It must be nothing. */
const touched: string[] = [];

/** The person's snooze: an exempt run, stopped by neither the breaker nor the daily limit. */
const SNOOZE: DispatchRequest = {
  envelope: recheckEnvelope({
    event_id: 'check-1:0',
    page_id: 'page-1',
    reason_code: 'user_snooze',
  }),
  provenance: { origin: 'scheduled_check', reasonCode: 'user_snooze' },
  recordAttempt: () => {
    touched.push('attempt');

    return Promise.resolve();
  },
};

/**
 * Wires up the real runner, grant, run gates and dispatcher. Only the stores are stubs: the grant
 * sees the `moments` it is given, and the budget and the ledger record that they were consulted.
 */
async function dispatcherWithGrant(moments: GrantMoments | null): Promise<RunDispatcher> {
  const credentials: Pick<ConnectorCredentialRepository, 'moments'> = {
    moments: () => Promise.resolve(moments),
  };
  const budget: Pick<RunBudget, 'quotaBlockedUntil' | 'autonomousHold'> = {
    quotaBlockedUntil: () => {
      touched.push('quota');

      return Promise.resolve(null);
    },
    autonomousHold: () => {
      touched.push('breaker and daily limit');

      return Promise.resolve(null);
    },
  };
  const traces: Pick<RunTraceRepository, 'admit' | 'conclude' | 'occupiedSlots'> = {
    admit: () => {
      touched.push('admission');

      return Promise.resolve(null);
    },
    conclude: () => Promise.resolve(true),
    occupiedSlots: () => Promise.resolve(0),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [testConfig(runsConfig)],
    providers: [
      RunDispatcher,
      RunGates,
      BREAKER_NOTICE_PROVIDER,
      NOTION_WAIT_NOTICE_PROVIDER,
      ClaudeRunner,
      NotionMcpGrant,
      { provide: RUN_LAUNCHER, useExisting: ClaudeRunner },
      { provide: ConnectorCredentialRepository, useValue: credentials },
      unreached(NotionMcpOAuth),
      unreached(GbrainToken),
      { provide: CLAUDE_QUERY, useValue: () => [] },
      { provide: PLUGIN_DIGEST, useValue: () => '0a1b2c3d4e5f' },
      { provide: RunBudget, useValue: budget },
      { provide: RunTraceRepository, useValue: traces },
      { provide: RUN_EFFECTS, useValue: new RecordingEffects() },
      { provide: budgetConfig.KEY, useValue: BUDGET },
      { provide: appConfig.KEY, useValue: APP },
      { provide: runnerConfig.KEY, useValue: RUNNER },
    ],
  }).compile();

  return moduleRef.get(RunDispatcher);
}

function granted(obtainedDaysAgo: number, refreshedDaysAgo: number): GrantMoments {
  return {
    obtainedAt: subDays(new Date(), obtainedDaysAgo),
    refreshedAt: subDays(new Date(), refreshedDaysAgo),
    accessTokenExpiresAt: subDays(new Date(), 1),
  };
}

beforeEach(() => {
  touched.length = 0;
});

/**
 * `INV-309` A dead Notion MCP grant is a `runner_not_ready` denial that comes before budget and
 * admission: there is no ledger row, the origin row's attempt is not spent, and the breaker does
 * not see a run denied for this reason.
 */
describe('INV-309', () => {
  const dead: [string, GrantMoments | null][] = [
    ['unauthorized', null],
    ['not refreshed for a month', granted(40, 31)],
    ['past the ceiling', granted(181, 1)],
  ];

  it.each(dead)(
    'a grant that is %s is denied before budget, admission and attempt',
    async (_, moments) => {
      const dispatcher = await dispatcherWithGrant(moments);
      const expected: DispatchResult = { started: false, denial: 'runner_not_ready' };

      await expect(dispatcher.dispatch(SNOOZE)).resolves.toEqual(expected);
      expect(touched).toEqual([]);
    },
  );

  /**
   * A live grant with an old access token is ready: whoever fetches the token refreshes it.
   * Otherwise the check above would pass even for a runner that is never ready.
   */
  it('a live grant lets the run through to budget and admission', async () => {
    const dispatcher = await dispatcherWithGrant(granted(10, 1));

    await expect(dispatcher.dispatch(SNOOZE)).resolves.toMatchObject({
      started: false,
      denial: 'concurrency',
    });
    expect(touched).toEqual(['quota', 'admission']);
  });
});
