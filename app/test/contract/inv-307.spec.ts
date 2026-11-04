import { allowedTools } from '../../src/claude/perimeter';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { canonical } from './contracts';

/**
 * `INV-307` An allow entry is a literal tool name within a single server, and a run's allow-set is
 * exactly the row of its mode. `SCEN-64-14` goes with it: a run's toolset is resolved from a matrix
 * row, not from everything the servers can do.
 *
 * The expected expansion is computed here independently of the runner's code, straight from the
 * contract: otherwise the test would check the function against itself.
 */
const toolsets = canonical.mcpToolsets();
const rows = canonical.modeToolsets().rows;

describe('INV-307', () => {
  it.each(Object.values(WorkflowMode))(
    '%s: every allow entry is a literal name within a single server',
    (mode) => {
      const loose = allowedTools(mode).filter(
        (tool) => !/^mcp__(app|notion|gbrain)__[A-Za-z0-9_-]+$/.test(tool),
      );

      expect(loose).toEqual([]);
    },
  );

  it.each(Object.values(WorkflowMode))('%s: the allow-set equals the matrix row', (mode) => {
    const expected = Object.entries(rows[mode]).flatMap(([server, bundles]) =>
      bundles.flatMap((bundle) =>
        (toolsets[server].bundles[bundle] ?? []).flatMap((capability) =>
          (toolsets[server].capabilities[capability] ?? []).map(
            (tool) => `mcp__${server}__${tool}`,
          ),
        ),
      ),
    );

    expect(allowedTools(mode)).toEqual([...new Set(expected)].sort());
  });
});
