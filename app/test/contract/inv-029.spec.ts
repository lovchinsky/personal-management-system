import { resolve } from 'node:path';
import { importsOf, shippedSources, SRC, within } from './sources';

const MCP = resolve(SRC, 'mcp');

/**
 * The paths by which code launches Claude: the runner, the run dispatcher and scheduler, the SDK
 * itself.
 */
const LAUNCHERS = [
  resolve(SRC, 'claude'),
  resolve(SRC, 'runs/run.dispatcher.ts'),
  resolve(SRC, 'runs/run.launcher.ts'),
  resolve(SRC, 'runs/run.scheduler.ts'),
];

/**
 * `INV-029` The App MCP does not launch Claude recursively.
 *
 * The invariant is checked mechanically: the `mcp/` code has no path to what launches a run, not
 * to the runner, not to the dispatcher and not to the SDK. An App MCP call is part of an already
 * active run and spawns no new one.
 */
describe('INV-029', () => {
  const imports = shippedSources(MCP).flatMap(importsOf);

  it('mcp/ imports nothing that launches a run', () => {
    const recursive = imports
      .filter(
        ({ edge, target }) =>
          edge.endsWith('@anthropic-ai/claude-agent-sdk') ||
          (target !== null &&
            LAUNCHERS.some((launcher) => target === launcher || within(launcher, target))),
      )
      .map(({ edge }) => edge);

    expect(recursive).toEqual([]);
  });

  /** Without this test, an empty walk of the directory would pass the check above silently. */
  it('finds the imports it checks', () => {
    expect(imports.map(({ target }) => target)).toContain(resolve(SRC, 'runs/run-effects.ts'));
  });
});
