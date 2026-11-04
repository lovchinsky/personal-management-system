import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../../src/claude/perimeter';
import { problemsOf } from '../fixtures/runner-init.fixture';

/**
 * `INV-302` The tool surface is closed in the run's effective configuration, not only in intent:
 * `tools` in the init message contains no built-in tool and no name outside `mcp__app__*`,
 * `mcp__notion__*`, `mcp__gbrain__*`, other than the declared harness tools and `Read` in the
 * plugin directory. The set equals the row's allow-set together with the harness tools and
 * `Read`.
 */
describe('INV-302', () => {
  const declared = [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS];

  it('the allow-set together with the harness tools and Read is the accepted set', () => {
    expect(problemsOf({ tools: declared })).toEqual([]);
  });

  it.each([
    'Bash',
    'Skill',
    'Write',
    'mcp__claude_ai_Gmail__search',
    'mcp__notion__notion-create-pages',
  ])('an extra name %s is a failure', (tool) => {
    expect(problemsOf({ tools: [...declared, tool] })).toEqual([expect.stringContaining(tool)]);
  });

  /**
   * A missing tool means that a server did not connect or that the policy is narrowed; both are
   * failures.
   */
  it('a missing allowed tool is also a failure', () => {
    const [dropped, ...rest] = declared.filter((tool) => tool.startsWith('mcp__notion__'));

    expect(problemsOf({ tools: declared.filter((tool) => tool !== dropped) })).toEqual([
      expect.stringContaining(dropped),
    ]);
    expect(rest.length).toBeGreaterThan(0);
  });

  it('StructuredOutput is a declared harness tool, not a leak', () => {
    expect(HARNESS_TOOLS).toContain('StructuredOutput');
    expect(problemsOf({ tools: declared })).toEqual([]);
  });
});
