import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../../src/claude/perimeter';
import { notionUnavailableFor, problemsOf } from '../fixtures/runner-init.fixture';

const connected = { app: 'connected', notion: 'connected', gbrain: 'connected' };

function servers(statuses: Record<string, string>): { name: string; status: string }[] {
  return Object.entries({ ...connected, ...statuses }).map(([name, status]) => ({ name, status }));
}

/**
 * `INV-301` A failed MCP server connection throws no error: the status of each server arrives in
 * the init message. A run without `connected` on a required server — Notion or App — is never a
 * run with the outcome `no_action`: it is a technical failure, and when the only problem is that
 * Notion is currently not responding, it is a deferral (`INV-109`). GBrain degrades.
 *
 * The function takes only the init message and the row's requirements, so it is checked on init
 * fixtures.
 */
describe('INV-301', () => {
  it.each([
    ['notion', 'failed'],
    ['notion', 'needs-auth'],
    ['app', 'failed'],
    ['app', 'pending'],
  ])('a required %s with status %s is a failure', (server, status) => {
    expect(problemsOf({ mcp_servers: servers({ [server]: status }) })).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`required MCP server ${server} is ${status}`),
      ]),
    );
  });

  /** A Notion that did not connect takes its tools with it: the init message shows them missing. */
  const withoutNotion = [
    ...allowedTools('event_evaluation'),
    ...PLUGIN_TOOLS,
    ...HARNESS_TOOLS,
  ].filter((tool) => !tool.startsWith('mcp__notion__'));

  it.each([
    ['failed', true],
    ['pending', true],
    ['needs-auth', false],
    ['disabled', false],
  ])('Notion with status %s as the only problem is a deferral: %s', (status, deferred) => {
    expect(
      notionUnavailableFor({ mcp_servers: servers({ notion: status }), tools: withoutNotion }),
    ).toBe(deferred);
  });

  it('a Notion that is not responding alongside another problem is a failure', () => {
    expect(
      notionUnavailableFor({
        mcp_servers: servers({ notion: 'failed', app: 'failed' }),
        tools: withoutNotion,
      }),
    ).toBe(false);
  });

  it('a GBrain that did not connect degrades: its tools drop out of the expected set', () => {
    const withoutGbrain = [
      ...allowedTools('event_evaluation'),
      ...PLUGIN_TOOLS,
      ...HARNESS_TOOLS,
    ].filter((tool) => !tool.startsWith('mcp__gbrain__'));

    expect(
      problemsOf({ mcp_servers: servers({ gbrain: 'failed' }), tools: withoutGbrain }),
    ).toEqual([]);
  });

  it('all connected: the run can be trusted', () => {
    expect(problemsOf()).toEqual([]);
  });
});
