import {
  allowedTools,
  BUILT_IN_TOOLS,
  HARNESS_TOOLS,
  PLUGIN_TOOLS,
  pluginReadRule,
} from '../../src/claude/perimeter';
import { PLUGIN_DIR } from '../fixtures/claude-stream.fixture';
import { problemsOf } from '../fixtures/runner-init.fixture';
import { MODES, optionsFor } from '../fixtures/runner-options.fixture';

/**
 * `INV-049` An App-triggered run receives exactly three MCP domains and no built-in tool except
 * `Read` in the plugin directory. The perimeter is set by the pair `allowedTools` +
 * `permissionMode: 'dontAsk'`. `tools` leaves only `Read`, `disallowedTools` lists the remaining
 * built-in tools by name as a second layer, and `strictMcpConfig` with `settingSources: []` keeps
 * ambient configuration out of the run.
 *
 * The check has two sides: the options object is the intent, and init is what the run actually
 * received.
 */
describe('INV-049', () => {
  it.each(MODES)('the %s options close the perimeter', (mode) => {
    const options = optionsFor(mode);

    expect(options).toMatchObject({
      tools: [...PLUGIN_TOOLS],
      permissionMode: 'dontAsk',
      strictMcpConfig: true,
      settingSources: [],
    });
    expect(options.allowedTools).toEqual([...allowedTools(mode), pluginReadRule(PLUGIN_DIR)]);
    expect(options.disallowedTools).toEqual(expect.arrayContaining([...BUILT_IN_TOOLS]));
    expect(Object.keys(options.mcpServers ?? {}).sort()).toEqual(['app', 'gbrain', 'notion']);
  });

  /**
   * The forbidden list consists of names the contract knows: a tool the contract does not know is
   * not forbidden and shows up in `init.tools`, and the init check aborts the run.
   * `notion-get-self` is a tool the contract does not know: the hosted endpoint returns it, and no
   * snapshot includes it.
   */
  it.each(MODES)('the %s options forbid notion-get-self instead of leaving it unknown', (mode) => {
    const options = optionsFor(mode);

    expect(options.disallowedTools).toContain('mcp__notion__notion-get-self');
    expect(options.allowedTools).not.toContain('mcp__notion__notion-get-self');
  });

  it('an init that received a built-in tool does not let the run continue', () => {
    const tools = [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS, 'Write'];

    expect(problemsOf({ tools })).toEqual([expect.stringContaining('Write')]);
  });

  /**
   * Deny takes precedence over allow: a forbidden `Read` would not read even the plugin directory.
   */
  it('Read is not in the list of forbidden built-in tools', () => {
    expect(BUILT_IN_TOOLS).not.toContain('Read');
    expect(PLUGIN_TOOLS).toEqual(['Read']);
  });
});
