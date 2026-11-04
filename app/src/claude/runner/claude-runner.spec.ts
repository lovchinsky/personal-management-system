import { existsSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addMilliseconds } from 'date-fns';
import {
  initMessage,
  PLUGIN_DIR,
  PROFILE_MODEL,
  resultMessage,
  ScriptedQuery,
  StreamMessage,
  toolResult,
  toolUse,
} from '../../../test/fixtures/claude-stream.fixture';
import { ConnectorUnauthorizedError } from '../../credentials/connector-unauthorized.error';
import { ConnectorUnavailableError } from '../../credentials/connector-unavailable.error';
import { GbrainToken } from '../../credentials/gbrain/gbrain.token';
import { GrantLiveness, NotionMcpGrant } from '../../credentials/notion-mcp/notion-mcp.grant';
import { ScheduledProvenance } from '../../runs/provenance';
import { RunOutcome } from '../../runs/run-outcome';
import { AdmittedRun, Readiness } from '../../runs/run.launcher';
import { eventEnvelope, reviewEnvelope } from '../../runs/trigger-envelope';
import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../perimeter';
import { CLAUDE_QUERY } from './claude-query';
import { ClaudeRunner } from './claude-runner';
import { PLUGIN_DIGEST, type PluginDigest } from './plugin-digest';
import { RUN_ENV_NAMES } from './run-env';
import { PLUGIN_NAME, SKILL_COMMAND } from './run-invocation';
import { RUN_TAP, type AttemptView, type RunTap } from './run-tap';
import { runnerConfig, type RunnerConfig } from './runner.config';

const APP_BEARER = 'app-bearer-0123456789';
const APP_URL = 'http://127.0.0.1:3000/mcp';
/** How much of the ticket is left to the run at startup; the tokens must live that long. */
const TICKET_LEFT_MS = 600_000;
const NOTION_TOKEN = 'notion-token-0123456789';
const GBRAIN_TOKEN = 'gbrain-token-0123456789';
const OAUTH_TOKEN = 'oauth-token-0123456789';
const PLUGIN_FINGERPRINT = '0a1b2c3d4e5f';

function admitted(signal: AbortSignal = new AbortController().signal): AdmittedRun {
  return {
    id: 'run-1',
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
    expiresAt: addMilliseconds(new Date(), TICKET_LEFT_MS),
    signal,
    app: { url: APP_URL, bearer: APP_BEARER },
  };
}

const READ_PAGE: StreamMessage[] = [
  toolUse('t1', 'mcp__notion__notion-fetch', { id: 'page-read-1' }),
  toolResult('t1', '{"id":"page-read-1"}'),
];

interface Credentials {
  readonly notion?: NotionMcpGrant['accessToken'];
  readonly liveness?: () => Promise<GrantLiveness>;
  readonly gbrain?: () => Promise<string>;
}

async function runnerOver(
  query: ScriptedQuery,
  credentials: Credentials = {},
  enabled = true,
  tap?: RunTap,
  digest: PluginDigest = () => PLUGIN_FINGERPRINT,
): Promise<ClaudeRunner> {
  const notion: Pick<NotionMcpGrant, 'accessToken' | 'serverUrl' | 'liveness'> = {
    accessToken: credentials.notion ?? (() => Promise.resolve(NOTION_TOKEN)),
    serverUrl: () => 'https://mcp.notion.com/mcp',
    liveness: credentials.liveness ?? (() => Promise.resolve({ alive: true })),
  };
  const gbrain: Pick<GbrainToken, 'accessToken'> = {
    accessToken: credentials.gbrain ?? (() => Promise.resolve(GBRAIN_TOKEN)),
  };
  const runner: RunnerConfig = {
    enabled,
    oauthToken: OAUTH_TOKEN,
    pluginDir: PLUGIN_DIR,
    gbrainMcpUrl: 'http://gbrain:3131/mcp',
    path: '/usr/bin',
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ClaudeRunner,
      { provide: NotionMcpGrant, useValue: notion },
      { provide: GbrainToken, useValue: gbrain },
      { provide: CLAUDE_QUERY, useValue: query.query },
      { provide: PLUGIN_DIGEST, useValue: digest },
      { provide: runnerConfig.KEY, useValue: runner },
      ...(tap === undefined ? [] : [{ provide: RUN_TAP, useValue: tap }]),
    ],
  }).compile();

  return moduleRef.get(ClaudeRunner);
}

describe('the runner', () => {
  it('is available only behind the switch', async () => {
    const query = new ScriptedQuery(() => []);

    expect((await runnerOver(query, {}, true)).available).toBe(true);
    expect((await runnerOver(query, {}, false)).available).toBe(false);
  });

  /**
   * The image does not change: its plugin is read once, and every run trace names the same digest.
   */
  it('computes the plugin digest once per process and puts it in the init snapshot', async () => {
    const digests: string[] = [];
    const query = new ScriptedQuery(() => [
      initMessage('run-1'),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);
    const runner = await runnerOver(query, {}, true, undefined, (directory) => {
      digests.push(directory);

      return PLUGIN_FINGERPRINT;
    });

    await runner.launch(admitted());

    const outcome = await runner.launch(admitted());

    expect(digests).toEqual([PLUGIN_DIR]);
    expect(outcome).toMatchObject({ observation: { init: { pluginDigest: PLUGIN_FINGERPRINT } } });
  });

  /**
   * The plugin digest is required in the run trace: without it a run does not start.
   */
  it('stops the run before a request to the model when the plugin is unreadable', async () => {
    const query = new ScriptedQuery(() => []);
    const runner = await runnerOver(query, {}, true, undefined, () => {
      throw new Error('plugin is unreadable');
    });

    await expect(runner.launch(admitted())).rejects.toThrow('plugin is unreadable');
    expect(query.calls).toEqual([]);
  });

  it('completes a valid run, and the run directory exists only for the duration of the run', async () => {
    let homeDuringRun = '';
    let homeExisted = false;
    const query = new ScriptedQuery((params) => {
      homeDuringRun = params.options.env?.HOME ?? '';
      homeExisted = existsSync(homeDuringRun);

      return [initMessage('run-1'), ...READ_PAGE, resultMessage('run-1')];
    });

    const outcome = await (await runnerOver(query)).launch(admitted());

    expect(outcome.status).toBe('completed');
    expect(homeExisted).toBe(true);
    expect(existsSync(homeDuringRun)).toBe(false);
  });

  it('passes the Skill command with the envelope and the servers with their bearers to `query()`', async () => {
    const query = new ScriptedQuery(() => [
      initMessage('run-1'),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);

    await (await runnerOver(query)).launch(admitted());

    const [{ prompt, options }] = query.calls;

    expect(prompt.startsWith(`${SKILL_COMMAND} `)).toBe(true);
    expect(JSON.parse(prompt.slice(SKILL_COMMAND.length + 1))).toEqual(admitted().envelope);
    expect(options.tools).toEqual([...PLUGIN_TOOLS]);
    expect(options.mcpServers).toEqual({
      app: {
        type: 'http',
        url: APP_URL,
        headers: { Authorization: `Bearer ${APP_BEARER}` },
        alwaysLoad: true,
      },
      notion: {
        type: 'http',
        url: 'https://mcp.notion.com/mcp',
        headers: { Authorization: `Bearer ${NOTION_TOKEN}` },
        alwaysLoad: true,
      },
      gbrain: {
        type: 'http',
        url: 'http://gbrain:3131/mcp',
        headers: { Authorization: `Bearer ${GBRAIN_TOKEN}` },
        alwaysLoad: true,
      },
    });
    expect(Object.keys(options.env ?? {}).sort()).toEqual([...RUN_ENV_NAMES].sort());
    expect(options.sessionId).toBe('run-1');
  });

  /** An ordinary run has nothing beyond its mode: no instructions, the profile's model. */
  it('launches a run without a shape with an empty system prompt and the profile model', async () => {
    const query = new ScriptedQuery(() => [
      initMessage('run-1'),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);

    await (await runnerOver(query)).launch(admitted());

    const [{ options }] = query.calls;

    expect(options.systemPrompt).toBe('');
    expect(options.model).toBe(PROFILE_MODEL);
  });

  /**
   * The shape travels with the run; the init of a run that has its own model is checked against
   * it.
   */
  it('takes instructions and a model from the run shape, and checks init against that model', async () => {
    const MODEL = 'claude-opus-9-9';
    const shaped: AdmittedRun = {
      ...admitted(),
      shape: { instructions: 'Return the structured result immediately.', model: MODEL },
    };
    const onModel = new ScriptedQuery(() => [
      initMessage('run-1', 'event_evaluation', { model: MODEL }),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);
    const onProfile = new ScriptedQuery(() => [initMessage('run-1'), resultMessage('run-1')]);

    await (await runnerOver(onModel)).launch(shaped);

    const [{ options, prompt }] = onModel.calls;

    expect(JSON.parse(prompt)).toEqual(shaped.envelope);
    expect(options.systemPrompt).toBe('Return the structured result immediately.');
    expect(options.model).toBe(MODEL);
    await expect((await runnerOver(onProfile)).launch(shaped)).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining(`not the profile's ${MODEL}`),
    });
  });

  /**
   * Readiness means a live Notion MCP grant: only the person can bring a dead one back, so a run
   * without it is denied before admission (`INV-309`).
   */
  it('is ready only when the Notion MCP grant is live', async () => {
    const query = new ScriptedQuery(() => []);
    const dead: GrantLiveness = { alive: false, reason: 'Notion MCP is not authorized' };
    const notReady: Readiness = { ready: false, reason: 'Notion MCP is not authorized' };
    const ready: Readiness = { ready: true };

    await expect((await runnerOver(query)).readiness()).resolves.toEqual(ready);
    await expect(
      (await runnerOver(query, { liveness: () => Promise.resolve(dead) })).readiness(),
    ).resolves.toEqual(notReady);
  });

  /** The header is set once at startup, so the token must live to the end of the ticket. */
  it('asks for the Notion token for the whole remainder of the ticket', async () => {
    const asked: number[] = [];
    const query = new ScriptedQuery(() => [
      initMessage('run-1'),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);
    const runner = await runnerOver(query, {
      notion: (validForMs) => {
        asked.push(validForMs);

        return Promise.resolve(NOTION_TOKEN);
      },
    });

    await runner.launch(admitted());

    expect(asked).toHaveLength(1);
    expect(asked[0]).toBeGreaterThan(TICKET_LEFT_MS - 5_000);
    expect(asked[0]).toBeLessThanOrEqual(TICKET_LEFT_MS);
  });

  /** Without Notion a run has nothing to work with: the process does not launch at all. */
  it('fails without a launch when Notion has no grant', async () => {
    const query = new ScriptedQuery(() => []);
    const runner = await runnerOver(query, {
      notion: () => Promise.reject(new ConnectorUnauthorizedError('notion_mcp', 'not authorized')),
    });

    const outcome = await runner.launch(admitted());

    expect(outcome).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('notion_mcp'),
    });
    expect(query.calls).toHaveLength(0);
  });

  /**
   * Notion access that failed to refresh because of a refusal that clears on its own is not a
   * failure: the run waits for Notion (ADR 0045). The process does not launch, as without a grant.
   */
  it('defers without a launch when Notion is currently not responding', async () => {
    const query = new ScriptedQuery(() => []);
    const runner = await runnerOver(query, {
      notion: () => Promise.reject(new ConnectorUnavailableError('notion_mcp', 'fetch failed')),
    });

    const outcome = await runner.launch(admitted());
    const expected: RunOutcome = {
      status: 'deferred',
      cause: 'notion',
      reason: 'Notion MCP is unavailable to the run: notion_mcp is unavailable: fetch failed',
    };

    expect(outcome).toEqual(expected);
    expect(query.calls).toHaveLength(0);
  });

  /** Three wake attempts fit into half a minute, so a grant pause would make the reminder fail. */
  it("lets only the wake of a person's snooze bypass the pause after a provider refusal", async () => {
    const SNOOZE: ScheduledProvenance = { origin: 'scheduled_check', reasonCode: 'user_snooze' };
    const SAFETY: ScheduledProvenance = { origin: 'scheduled_check', reasonCode: 'safety_recheck' };
    const asked: Parameters<NotionMcpGrant['accessToken']>[1][] = [];
    const query = new ScriptedQuery(() => [
      initMessage('run-1'),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);
    const runner = await runnerOver(query, {
      notion: (_validForMs, request) => {
        asked.push(request);

        return Promise.resolve(NOTION_TOKEN);
      },
    });

    for (const provenance of [SNOOZE, SAFETY]) await runner.launch({ ...admitted(), provenance });
    await runner.launch(admitted());

    expect(asked).toEqual([
      { bypassCooldown: true },
      { bypassCooldown: false },
      { bypassCooldown: false },
    ]);
  });

  /**
   * Notion did not connect, and it is the only init discrepancy: the model has not started, and a
   * retry makes sense.
   */
  it('treats an init on which Notion did not connect as a deferral, not a failure', async () => {
    const query = new ScriptedQuery(() => [
      initMessage('run-1', 'event_evaluation', {
        tools: [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS].filter(
          (tool) => !tool.startsWith('mcp__notion__'),
        ),
        mcp_servers: [
          { name: 'app', status: 'connected' },
          { name: 'notion', status: 'failed' },
          { name: 'gbrain', status: 'connected' },
        ],
      }),
      resultMessage('run-1'),
    ]);

    const outcome = await (await runnerOver(query)).launch(admitted());

    expect(outcome).toMatchObject({
      status: 'deferred',
      cause: 'notion',
      reason: 'Notion MCP was not connected: required MCP server notion is failed',
    });
  });

  /** GBrain degrades: the run proceeds without it, and init records the degradation (`INV-301`). */
  it('proceeds without GBrain when the run gets no GBrain token', async () => {
    const withoutGbrain = [
      ...allowedTools('event_evaluation'),
      ...PLUGIN_TOOLS,
      ...HARNESS_TOOLS,
    ].filter((tool) => !tool.startsWith('mcp__gbrain__'));
    const query = new ScriptedQuery(() => [
      initMessage('run-1', 'event_evaluation', {
        tools: withoutGbrain,
        mcp_servers: [
          { name: 'app', status: 'connected' },
          { name: 'notion', status: 'connected' },
        ],
      }),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);
    const runner = await runnerOver(query, {
      gbrain: () => Promise.reject(new Error('GBrain token request failed: 503')),
    });

    const outcome = await runner.launch(admitted());

    expect(Object.keys(query.calls[0].options.mcpServers ?? {}).sort()).toEqual(['app', 'notion']);
    expect(outcome.status).toBe('completed');
  });

  /** A matrix row without GBrain bundles: the server is not in the run, and no token is taken. */
  it('proceeds without GBrain in a Daily Control run', async () => {
    const asked: unknown[] = [];
    const query = new ScriptedQuery(() => [
      initMessage('run-1', 'daily_control', {
        mcp_servers: [
          { name: 'app', status: 'connected' },
          { name: 'notion', status: 'connected' },
        ],
      }),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);
    const runner = await runnerOver(query, {
      gbrain: () => {
        asked.push(1);

        return Promise.resolve(GBRAIN_TOKEN);
      },
    });

    await runner.launch({
      ...admitted(),
      envelope: reviewEnvelope('daily_control', {
        event_id: 'review:daily_control:2026-10-15',
        timestamp: '2026-10-15T05:30:00.000Z',
        since: '2026-10-14T05:30:00.000Z',
      }),
      provenance: { origin: 'review_schedule' },
    });

    expect(Object.keys(query.calls[0].options.mcpServers ?? {}).sort()).toEqual(['app', 'notion']);
    expect(asked).toEqual([]);
  });

  /** A perimeter that cannot be trusted aborts the run before the first request to the model. */
  it('aborts right after init when init shows a tool outside the allow-set', async () => {
    const query = new ScriptedQuery(() => [
      initMessage('run-1', 'event_evaluation', {
        tools: [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS, 'Bash'],
      }),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);

    const outcome = await (await runnerOver(query)).launch(admitted());

    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('Bash') });
    expect(outcome.status === 'failed' && outcome.report).toBeUndefined();
  });

  /**
   * A vendor's hosted server adds tools without warning (`ADR 0031`): init shows an unknown tool,
   * the runner denies it and repeats the launch. The CLI does not show what is denied, so the
   * second init is clean.
   */
  describe('unknown vendor tool', () => {
    const NEW_TOOL = 'mcp__notion__notion-new-feature';
    const declared = [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS];

    /** A server that serves `extra` until it is denied in the invocation options. */
    const serving = (extra: string[]): ScriptedQuery =>
      new ScriptedQuery((params) => {
        const denied = params.options.disallowedTools ?? [];
        const shown = extra.filter((tool) => !denied.includes(tool));

        return [
          initMessage('run-1', 'event_evaluation', { tools: [...declared, ...shown] }),
          ...READ_PAGE,
          resultMessage('run-1'),
        ];
      });

    it('is denied and the launch repeated: the run completes, and the second attempt does not have it', async () => {
      const query = serving([NEW_TOOL]);

      const outcome = await (await runnerOver(query)).launch(admitted());

      expect(outcome.status).toBe('completed');
      expect(query.calls).toHaveLength(2);
      expect(query.calls[0].options.disallowedTools).not.toContain(NEW_TOOL);
      expect(query.calls[1].options.disallowedTools).toContain(NEW_TOOL);
    });

    it('is denied at once by the next run, without a retry', async () => {
      const query = serving([NEW_TOOL]);
      const runner = await runnerOver(query);

      await runner.launch(admitted());
      await runner.launch(admitted());

      expect(query.calls).toHaveLength(3);
      expect(query.calls[2].options.disallowedTools).toContain(NEW_TOOL);
    });

    /**
     * A server that the CLI shows even though it is denied produces drift in every run, but there
     * is only one warning per name, because otherwise the log would repeat it every time.
     */
    it('is warned about once per name', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const stubborn = new ScriptedQuery(() => [
        initMessage('run-1', 'event_evaluation', { tools: [...declared, NEW_TOOL] }),
        resultMessage('run-1'),
      ]);
      const runner = await runnerOver(stubborn);

      await runner.launch(admitted());
      await runner.launch(admitted());

      expect(warn.mock.calls.filter(([text]) => String(text).includes(NEW_TOOL))).toHaveLength(1);
      warn.mockRestore();
    });

    /** A known mutating tool in init means the deny layer did not work: a retry will not fix it. */
    it.each(['mcp__notion__notion-create-pages', 'Bash'])(
      'fails without a retry when %s is in init',
      async (tool) => {
        const query = new ScriptedQuery(() => [
          initMessage('run-1', 'event_evaluation', { tools: [...declared, tool] }),
          resultMessage('run-1'),
        ]);

        const outcome = await (await runnerOver(query)).launch(admitted());

        expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining(tool) });
        expect(query.calls).toHaveLength(1);
      },
    );

    it('fails instead of retrying endlessly when drift appears on the second attempt too', async () => {
      let attempt = 0;
      const query = new ScriptedQuery(() => {
        attempt += 1;

        return [
          initMessage('run-1', 'event_evaluation', {
            tools: [...declared, `mcp__notion__notion-new-feature-${attempt}`],
          }),
          resultMessage('run-1'),
        ];
      });

      const outcome = await (await runnerOver(query)).launch(admitted());

      expect(outcome).toMatchObject({ status: 'failed' });
      expect(query.calls).toHaveLength(2);
    });
  });

  /**
   * An init that cannot be read is a perimeter that cannot be checked: the abort comes right after
   * it, not after all the turns, when the writes to the domains are already done.
   */
  it('aborts right after init when init has an unfamiliar shape', async () => {
    const query = new ScriptedQuery(() => [
      initMessage('run-1', 'event_evaluation', {
        plugins: [{ name: PLUGIN_NAME, path: PLUGIN_DIR, version: null }],
      }),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);

    const outcome = await (await runnerOver(query)).launch(admitted());

    expect(outcome).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('unexpected shape'),
    });
    expect(outcome.status === 'failed' && outcome.report).toBeUndefined();
  });

  /**
   * Without the Skill in init the CLI would read the command as plain text, and the run would go
   * without instructions, with no sign of failure.
   */
  it('aborts right after init when init lacks the Skill', async () => {
    const query = new ScriptedQuery(() => [
      initMessage('run-1', 'event_evaluation', { skills: ['code-review'] }),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);

    const outcome = await (await runnerOver(query)).launch(admitted());

    expect(outcome).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('is not in init.skills'),
    });
    expect(outcome.status === 'failed' && outcome.report).toBeUndefined();
  });

  /**
   * A result the CLI rejected by the schema costs a model round, and the run trace keeps only the
   * last reason, so the runner writes every rejection to the log: the path and the rule, without
   * the CLI wrapper.
   */
  describe('schema rejection of a result', () => {
    const rejecting = (text: string): ScriptedQuery =>
      new ScriptedQuery(() => [
        initMessage('run-1'),
        ...READ_PAGE,
        toolUse('t2', 'StructuredOutput'),
        toolResult('t2', text, true),
        resultMessage('run-1'),
      ]);

    const logged = (warn: jest.SpyInstance): string[] =>
      warn.mock.calls
        .map(([text]) => String(text))
        .filter((text) => text.includes('rejected by the schema'));

    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('writes the path and the rule to the log without the CLI wrapper, and a run that corrected itself stays completed', async () => {
      const query = rejecting(
        '<tool_use_error>Output does not match required schema: /detections/0/type</tool_use_error>',
      );

      const outcome = await (await runnerOver(query)).launch(admitted());

      expect(outcome.status).toBe('completed');
      expect(logged(warn)).toEqual([
        'run-1: the result was rejected by the schema: Output does not match required schema: /detections/0/type',
      ]);
    });

    /**
     * Redaction first, then truncation: a secret on the truncation boundary would leave a fragment
     * that redaction does not recognize.
     */
    it('redacts a secret on the truncation boundary whole instead of leaving a fragment', async () => {
      const query = rejecting(`${'x'.repeat(1_995)}${NOTION_TOKEN}`);

      await (await runnerOver(query)).launch(admitted());

      const [text] = logged(warn);

      // Truncating first would leave “notio”, five characters of the token that redaction does not
      // recognize.
      expect(text).not.toContain('notio');
    });

    it('truncates a long rejection at the log limit', async () => {
      await (await runnerOver(rejecting('y'.repeat(5_000)))).launch(admitted());

      const [text] = logged(warn);
      const prefix = 'run-1: the result was rejected by the schema: ';

      expect(text?.length).toBe(prefix.length + 2_000);
    });

    it('writes nothing for a run without rejections', async () => {
      const query = new ScriptedQuery(() => [
        initMessage('run-1'),
        ...READ_PAGE,
        resultMessage('run-1'),
      ]);

      await (await runnerOver(query)).launch(admitted());

      expect(logged(warn)).toEqual([]);
    });
  });

  /**
   * The attempt subscriber sees what the run trace does not keep (`GAP-07`): which plugin files the
   * run opened and the text of the CLI's rejections of the result. Without a subscriber the
   * runner's behavior and log are the same.
   */
  describe('attempt subscriber', () => {
    const SKILL = `${PLUGIN_DIR}/skills/run/SKILL.md`;

    const reading = (rejection?: string): ScriptedQuery =>
      new ScriptedQuery(() => [
        initMessage('run-1'),
        toolUse('r1', 'Read', { file_path: SKILL }),
        toolResult('r1', 'file text'),
        ...READ_PAGE,
        ...(rejection === undefined
          ? []
          : [toolUse('t2', 'StructuredOutput'), toolResult('t2', rejection, true)]),
        resultMessage('run-1'),
      ]);

    const recording = (): { tap: RunTap; seen: [string, AttemptView][] } => {
      const seen: [string, AttemptView][] = [];

      return { tap: { attempted: (runId, view) => void seen.push([runId, view]) }, seen };
    };

    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('gets the run id, the files read relative to the plugin directory and the rejection reasons', async () => {
      const { tap, seen } = recording();

      await (
        await runnerOver(reading('Output does not match: /type'), {}, true, tap)
      ).launch(admitted());

      expect(seen).toEqual([
        [
          'run-1',
          {
            skillReads: ['skills/run/SKILL.md'],
            rejections: ['Output does not match: /type'],
            gbrainCalls: [],
            transcript: expect.any(Array),
          },
        ],
      ]);
    });

    /** The stream is what shows why the run reached its conclusion: every message, in order. */
    it("gets the whole stream of the attempt in order, without the run's secrets", async () => {
      const { tap, seen } = recording();
      const query = new ScriptedQuery(() => [
        initMessage('run-1'),
        toolUse('r1', 'Read', { file_path: SKILL }),
        toolResult('r1', `the page says ${NOTION_TOKEN}`),
        ...READ_PAGE,
        resultMessage('run-1'),
      ]);

      await (await runnerOver(query, {}, true, tap)).launch(admitted());

      const [[, view]] = seen;
      const stream = JSON.stringify(view.transcript);

      expect(view.transcript).toHaveLength(4 + READ_PAGE.length);
      expect(stream).toContain('the page says [redacted]');
      expect(stream).not.toContain(NOTION_TOKEN);
    });

    /**
     * The subscriber sees the same thing as the log: redaction first, then truncation, because a
     * secret does not reach anywhere the log does not.
     */
    it('receives the reasons redacted and truncated the same way as in the log', async () => {
      const { tap, seen } = recording();

      await (
        await runnerOver(reading(`${'x'.repeat(1_995)}${NOTION_TOKEN}`), {}, true, tap)
      ).launch(admitted());

      const [[, view]] = seen;

      expect(view.rejections[0]).not.toContain('notio');
      expect(view.rejections[0]?.length).toBe(2_000);
    });

    it('gets a second message for the second attempt of the same run after init drift', async () => {
      const { tap, seen } = recording();
      const NEW_TOOL = 'mcp__notion__notion-new-feature';
      const declared = [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS];
      const query = new ScriptedQuery((params) => {
        const denied = params.options.disallowedTools ?? [];
        const shown = [NEW_TOOL].filter((tool) => !denied.includes(tool));

        return [
          initMessage('run-1', 'event_evaluation', { tools: [...declared, ...shown] }),
          toolUse('r1', 'Read', { file_path: SKILL }),
          toolResult('r1', 'file text'),
          ...READ_PAGE,
          resultMessage('run-1'),
        ];
      });

      await (await runnerOver(query, {}, true, tap)).launch(admitted());

      expect(seen.map(([runId]) => runId)).toEqual(['run-1', 'run-1']);
      expect(seen[1]?.[1].skillReads).toEqual(['skills/run/SKILL.md']);
    });

    it('does not fail the run on a run subscriber failure and leaves a log entry', async () => {
      const failing: RunTap = {
        attempted: () => {
          throw new Error('collector is down');
        },
      };

      const outcome = await (await runnerOver(reading(), {}, true, failing)).launch(admitted());

      expect(outcome.status).toBe('completed');
      expect(warn).toHaveBeenCalledWith('run-1: the run tap failed — collector is down');
    });

    it('leaves the run unchanged without a subscriber', async () => {
      const outcome = await (await runnerOver(reading())).launch(admitted());

      expect(outcome.status).toBe('completed');
    });
  });

  /**
   * `Read` in the plugin directory reads the entry and knowledge files; outside the directory the
   * CLI rejects it. A successful read outside the directory would mean the permission rule did not
   * work (managed policies, `GAP-13`), and that is a failure. A rejected attempt is not.
   */
  describe('Read outside the plugin directory', () => {
    const REFERENCE = `${PLUGIN_DIR}/skills/run/knowledge/ontology.md`;

    function outcomeOf(read: string, denied: boolean): Promise<RunOutcome> {
      const query = new ScriptedQuery(() => [
        initMessage('run-1'),
        toolUse('r1', 'Read', { file_path: read }),
        toolResult('r1', denied ? 'Permission to use Read has been denied' : 'file text', denied),
        ...READ_PAGE,
        resultMessage('run-1'),
      ]);

      return runnerOver(query).then((runner) => runner.launch(admitted()));
    }

    it('completes the run when a reference in the plugin directory is read', async () => {
      await expect(outcomeOf(REFERENCE, false)).resolves.toMatchObject({ status: 'completed' });
    });

    it('does not fail the run when an attempt to read a file outside the plugin directory is rejected: that is the perimeter at work', async () => {
      await expect(outcomeOf('/etc/passwd', true)).resolves.toMatchObject({
        status: 'completed',
      });
    });

    it.each(['/etc/passwd', `${PLUGIN_DIR}/../secrets.env`, 'relative/file.md'])(
      'treats a successful read of %s as a perimeter failure',
      async (path) => {
        await expect(outcomeOf(path, false)).resolves.toMatchObject({
          status: 'failed',
          error: expect.stringContaining('perimeter breach'),
        });
      },
    );
  });

  /** A directory that could not be removed does not change the outcome, only leaves a log entry. */
  it('does not replace the outcome when removing the run directory fails', async () => {
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const removal = jest
      .spyOn(fsPromises, 'rm')
      .mockRejectedValueOnce(new Error('ENOTEMPTY: directory not empty'));
    const query = new ScriptedQuery(() => [
      initMessage('run-1'),
      ...READ_PAGE,
      resultMessage('run-1'),
    ]);

    try {
      const outcome = await (await runnerOver(query)).launch(admitted());

      expect(outcome.status).toBe('completed');
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('was not removed'));
    } finally {
      removal.mockRestore();
      await fsPromises.rm(query.calls[0]?.options.env?.HOME ?? '', {
        recursive: true,
        force: true,
      });
    }
  });

  /**
   * The `abort` event does not fire twice: the runner reads a signal that has already fired from
   * its state, not from the event.
   */
  it('aborts the run before the first request when the signal fired before the launch', async () => {
    const deadline = new AbortController();
    let abortedAtStart = false;
    const query = new ScriptedQuery((params) => {
      abortedAtStart = params.options.abortController?.signal.aborted ?? false;

      return [initMessage('run-1'), ...READ_PAGE, resultMessage('run-1')];
    });

    deadline.abort(new Error('run reached its ticket deadline'));

    const outcome = await (await runnerOver(query)).launch(admitted(deadline.signal));

    expect(abortedAtStart).toBe(true);
    expect(outcome).toMatchObject({ status: 'failed', error: 'run reached its ticket deadline' });
  });

  it('aborts the run on the deadline signal', async () => {
    const deadline = new AbortController();
    const query = new ScriptedQuery(() => {
      deadline.abort(new Error('run reached its ticket deadline'));

      return [initMessage('run-1'), ...READ_PAGE, resultMessage('run-1')];
    });

    const outcome = await (await runnerOver(query)).launch(admitted(deadline.signal));

    expect(outcome).toMatchObject({ status: 'failed', error: 'run reached its ticket deadline' });
  });

  /** Bearers end up on the CLI's command line and can come back in its error. */
  it("keeps the run's secrets out of the outcome", async () => {
    const query = new ScriptedQuery(() => {
      throw new Error(
        `spawn failed: --mcp-config {"Authorization":"Bearer ${APP_BEARER}"} ${NOTION_TOKEN} ${OAUTH_TOKEN}`,
      );
    });

    const outcome = await (await runnerOver(query)).launch(admitted());
    const error = outcome.status === 'failed' ? outcome.error : '';

    expect(error).not.toContain(APP_BEARER);
    expect(error).not.toContain(NOTION_TOKEN);
    expect(error).not.toContain(OAUTH_TOKEN);
  });

  /**
   * The stderr tail is truncated to two thousand characters. A secret this limit cut in two would
   * leave its end, recognizable neither as the whole secret nor by the shape of a header.
   */
  it('does not leave the end of a secret that sits on the stderr tail boundary', async () => {
    const query = new ScriptedQuery((params) => {
      params.options.stderr?.(`${OAUTH_TOKEN}${'y'.repeat(1_990)}`);

      throw new Error('process exited with code 1');
    });

    const outcome = await (await runnerOver(query)).launch(admitted());
    const error = outcome.status === 'failed' ? outcome.error : '';

    expect(error).toContain('stderr');
    expect(error).not.toContain(OAUTH_TOKEN.slice(-10));
  });
});
