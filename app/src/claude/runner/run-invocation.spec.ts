import { resolve } from 'node:path';
import { PLUGIN_DIR } from '../../../test/fixtures/claude-stream.fixture';
import { ALL_SERVERS, invocationFor, MODES } from '../../../test/fixtures/runner-options.fixture';
import { pluginReadRule } from '../perimeter';
import { isSkillRun, promptOf, RunServers, SKILL_COMMAND, SKILL_NAME } from './run-invocation';

/** An invocation without GBrain: the run did not get its token. */
const WITHOUT_GBRAIN: RunServers = { app: ALL_SERVERS.app, notion: ALL_SERVERS.notion };

/**
 * The init expectation is derived from the same values as the options: the options set the
 * intent, init says what came of it, and an expectation written separately would diverge from
 * the intent (`INV-301`, `INV-302`).
 */
describe('run invocation', () => {
  it.each(MODES)('builds init expectations that match the options of the %s run', (mode) => {
    const { options, expects } = invocationFor(mode);

    expect(expects.runId).toBe(options.sessionId);
    expect(expects.model).toBe(options.model);
    expect(expects.permissionMode).toBe(options.permissionMode);
    // The allow-set of MCP tools is what init is checked against; `Read` in the plugin directory
    // is a separate rule.
    expect(options.allowedTools).toEqual([...expects.allowed, pluginReadRule(expects.pluginDir)]);
    expect(expects.skill).toBe(SKILL_NAME);
    expect(expects.attached).toEqual(Object.keys(options.mcpServers ?? {}));
    expect(options.plugins).toEqual([
      { type: 'local', path: resolve(expects.pluginDir), skipMcpDiscovery: true },
    ]);
    expect(expects.pluginDir).toBe(PLUGIN_DIR);
  });

  it('does not pass a server the run did not receive and does not expect it in init', () => {
    const { options, expects } = invocationFor('event_evaluation', WITHOUT_GBRAIN);

    expect(Object.keys(options.mcpServers ?? {})).toEqual(['app', 'notion']);
    expect(expects.attached).toEqual(['app', 'notion']);
  });

  /**
   * The Skill is loaded by a command, not at the model's discretion
   * (`docs/decisions/0020-skill-delivery-in-runs.md`).
   */
  it('prompts a Skill run with the plugin command and the envelope, and a run with instructions with the envelope alone', () => {
    const envelope = '{"mode":"dialogue"}';

    expect(isSkillRun('')).toBe(true);
    expect(promptOf(envelope, '')).toBe(`${SKILL_COMMAND} ${envelope}`);
    expect(isSkillRun('Return the structured result immediately.')).toBe(false);
    expect(promptOf(envelope, 'Return the structured result immediately.')).toBe(envelope);
  });

  it('does not expect the Skill in init for a run with its own instructions', () => {
    const own = invocationFor('event_evaluation', ALL_SERVERS, 'Do exactly this.');

    expect(own.expects.skill).toBeUndefined();
  });
});
