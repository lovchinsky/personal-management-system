import {
  initMessage,
  PLUGIN_DIR,
  StreamMessage,
} from '../../../test/fixtures/claude-stream.fixture';
import { driftFor, problemsOf } from '../../../test/fixtures/runner-init.fixture';
import { invocationFor } from '../../../test/fixtures/runner-options.fixture';
import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../perimeter';
import { notionUnavailableAtInit } from './init-check';
import { PLUGIN_NAME } from './run-invocation';
import { initMessageSchema } from './stream';

const BUILTIN = [
  { name: 'agents-md', path: 'builtin', source: 'agents-md@builtin' },
  { name: 'telemetry', path: 'builtin', source: 'telemetry@builtin' },
];

/**
 * The init check verifies what the run actually received, not what the options promised it. This
 * suite covers the parts the perimeter invariants do not: the session, the permission mode, the
 * model, the servers and the plugin.
 */
describe('init check', () => {
  it('does not stop the run for an init that matches the options', () => {
    expect(problemsOf()).toEqual([]);
  });

  /** The CLI adds builtin plugins itself, and not every time: their set is not deterministic. */
  it('ignores builtin plugins: neither their presence nor their absence matters', () => {
    expect(problemsOf({ plugins: [{ name: PLUGIN_NAME, path: PLUGIN_DIR }] })).toEqual([]);
    expect(problemsOf({ plugins: [{ name: PLUGIN_NAME, path: PLUGIN_DIR }, ...BUILTIN] })).toEqual(
      [],
    );
  });

  it.each([
    ['a plugin from another directory', [{ name: PLUGIN_NAME, path: '/home/someone/plugin' }]],
    ['no plugin', [...BUILTIN]],
    [
      'an extra non-builtin plugin',
      [
        { name: PLUGIN_NAME, path: PLUGIN_DIR },
        { name: 'other', path: '/opt/other' },
      ],
    ],
    ['a foreign plugin instead of ours', [{ name: 'other', path: PLUGIN_DIR }]],
  ])('treats %s as a failure', (_, plugins) => {
    expect(problemsOf({ plugins })).toEqual([expect.stringContaining(`${PLUGIN_NAME}@`)]);
  });

  it.each([
    ['a foreign session', { session_id: 'run-other' }, 'session'],
    ['a permission mode other than `dontAsk`', { permissionMode: 'default' }, 'permission mode'],
    ['a model other than the profile model', { model: 'claude-sonnet-5' }, 'model'],
  ])('treats %s as a failure', (_, overrides, named) => {
    expect(problemsOf(overrides)).toEqual([expect.stringContaining(named)]);
  });

  it('treats a server the options did not pass as a failure', () => {
    const servers = [
      { name: 'app', status: 'connected' },
      { name: 'notion', status: 'connected' },
      { name: 'gbrain', status: 'connected' },
      { name: 'claude_ai_Gmail', status: 'connected' },
    ];

    expect(problemsOf({ mcp_servers: servers })).toEqual([
      expect.stringContaining('unexpected MCP servers: claude_ai_Gmail'),
    ]);
  });
});

/**
 * A vendor's hosted server adds tools without warning. The suite separates the tools the runner
 * can deny and retry from those that remain a failure (`ADR 0031`).
 */
describe('vendor surface drift in init', () => {
  const declared = [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS];
  const withTools = (...extra: string[]): { tools: string[] } => ({
    tools: [...declared, ...extra],
  });

  it('finds no drift in a clean init', () => {
    expect(driftFor()).toEqual([]);
  });

  it('counts only unknown Notion and GBrain tools as drift', () => {
    const extra = ['mcp__notion__notion-new-feature', 'mcp__gbrain__brand_new_tool'];

    expect(driftFor(withTools(...extra))).toEqual(extra);
  });

  /**
   * A tool known to the contract that shows up in init outside the allow-set means the deny layer
   * did not work.
   */
  it('treats a known mutating tool as a failure, not drift', () => {
    expect(driftFor(withTools('mcp__notion__notion-create-pages'))).toEqual([]);
    expect(problemsOf(withTools('mcp__notion__notion-create-pages'))).not.toEqual([]);
  });

  it.each(['Bash', 'mcp__claude_ai_Gmail__search', 'mcp__app__add_comment_fake'])(
    'does not count %s as drift, because it is a built-in tool or comes from a foreign server',
    (tool) => {
      expect(driftFor(withTools(tool))).toEqual([]);
    },
  );

  it('finds no drift when an unknown tool comes with a known one, because a retry would not fix the known one', () => {
    expect(
      driftFor(withTools('mcp__notion__notion-new-feature', 'mcp__notion__notion-create-pages')),
    ).toEqual([]);
  });

  /** A retry with the new tool denied will not bring back a tool that is missing. */
  it('finds no drift when an unknown tool comes with a missing allowed one', () => {
    const [dropped] = declared.filter((tool) => tool.startsWith('mcp__notion__'));

    expect(
      driftFor({
        tools: [...declared.filter((tool) => tool !== dropped), 'mcp__notion__notion-new-feature'],
      }),
    ).toEqual([]);
  });

  it('finds no drift when an unknown tool comes with another init discrepancy', () => {
    expect(
      driftFor({ ...withTools('mcp__notion__notion-new-feature'), model: 'other-model' }),
    ).toEqual([]);
  });
});

/**
 * An init that stopped the run only because the Notion server is currently unavailable is not a
 * failure but a deferral (ADR 0045). A Notion server that did not connect takes its tools out of
 * init: that is how the CLI shows those tools, and that is how they leave the expected set.
 */
describe('Notion unavailable at init', () => {
  const unavailableAt = (overrides: StreamMessage): boolean =>
    notionUnavailableAtInit(
      initMessageSchema.parse(initMessage('run-1', 'event_evaluation', overrides)),
      invocationFor('event_evaluation').expects,
    );

  /**
   * Builds the init of a run whose servers have these statuses, without tools of unconnected
   * servers.
   */
  const servers = (statuses: Record<string, string>): StreamMessage => ({
    mcp_servers: Object.entries(statuses).map(([name, status]) => ({ name, status })),
    tools: [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS].filter(
      (tool) =>
        !Object.entries(statuses).some(
          ([name, status]) => status !== 'connected' && tool.startsWith(`mcp__${name}__`),
        ),
    ),
  });

  it.each(['failed', 'pending'])(
    'counts Notion %s with no other problem as unavailable',
    (status) => {
      expect(
        unavailableAt(servers({ app: 'connected', notion: status, gbrain: 'connected' })),
      ).toBe(true);
    },
  );

  /** Revoked access and a disabled server do not clear on their own: that is a failure. */
  it.each(['needs-auth', 'disabled'])('does not count Notion %s as unavailability', (status) => {
    expect(unavailableAt(servers({ app: 'connected', notion: status, gbrain: 'connected' }))).toBe(
      false,
    );
  });

  /**
   * A GBrain that did not connect degrades and does not stop the run (`INV-301`): there is no
   * second problem.
   */
  it('counts Notion as unavailable together with a GBrain that did not connect', () => {
    expect(unavailableAt(servers({ app: 'connected', notion: 'failed', gbrain: 'failed' }))).toBe(
      true,
    );
  });

  const NOTION_FAILED = servers({ app: 'connected', notion: 'failed', gbrain: 'connected' });

  const secondProblems: [string, StreamMessage][] = [
    [
      'an App server that did not connect',
      servers({ app: 'failed', notion: 'failed', gbrain: 'connected' }),
    ],
    ['another model', { ...NOTION_FAILED, model: 'other-model' }],
    [
      'Notion tools that stayed in init',
      {
        ...NOTION_FAILED,
        tools: [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS],
      },
    ],
  ];

  it.each(secondProblems)(
    'treats Notion with a second problem (%s) as a failure, not unavailability',
    (_, overrides) => {
      expect(unavailableAt(overrides)).toBe(false);
    },
  );

  it('does not count a connected Notion as unavailable', () => {
    expect(unavailableAt({})).toBe(false);
  });

  it('does not count a Notion that is absent from init altogether as unavailable', () => {
    expect(unavailableAt(servers({ app: 'connected', gbrain: 'connected' }))).toBe(false);
  });
});
