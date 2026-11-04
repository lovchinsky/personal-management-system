import { z } from 'zod';
import {
  allowedTools,
  BUILT_IN_TOOLS,
  HARNESS_TOOLS,
  knownTools,
  PLUGIN_TOOLS,
  REQUIRED_SERVERS,
  REVIEWED_FOR_SDK,
} from '../../src/claude/perimeter';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { MCP_SERVER_NAMES, MCP_TOOLSETS, MODE_TOOLSETS } from '../../src/runs/toolsets';
import { canonical, repoFile } from './contracts';

/**
 * The tool perimeter in the code and in the contract is the same.
 *
 * The running App does not read contracts, so the runner takes the perimeter from constants; a
 * divergence from the contract would silently change what the model sees. The table in
 * `docs/2-system.md` § “mode → toolset” is the human-readable form of the same key, and the table
 * cannot diverge from the key either.
 */
describe('toolsets and the contract', () => {
  const toolsets = canonical.mcpToolsets();
  const modeToolsets = canonical.modeToolsets();

  it('the mcp_toolsets mirror matches the contract', () => {
    for (const server of MCP_SERVER_NAMES) {
      const declared = toolsets[server];
      const mirrored = MCP_TOOLSETS[server];

      expect({
        capabilities: mirrored.capabilities,
        bundles: mirrored.bundles,
        withheld: [...mirrored.withheld],
        untriaged: [...mirrored.untriaged],
        systemVoice: [...mirrored.systemVoice],
      }).toEqual({
        capabilities: declared.capabilities,
        bundles: declared.bundles,
        withheld: Object.keys(declared.withheld ?? {}),
        untriaged: declared.untriaged ?? [],
        systemVoice: declared.system_voice ?? [],
      });
    }
  });

  it('the matrix rows, the required servers and the harness tools match the contract', () => {
    expect(MODE_TOOLSETS).toEqual(modeToolsets.rows);
    expect(Object.keys(MODE_TOOLSETS).sort()).toEqual(Object.values(WorkflowMode).sort());
    expect([...REQUIRED_SERVERS]).toEqual(modeToolsets.required_servers);
    expect([...HARNESS_TOOLS]).toEqual(canonical.harnessTools());
    expect([...PLUGIN_TOOLS]).toEqual(canonical.pluginTools().tools);
  });

  /** The chat row has no allow-set: its toolset is determined by the person, not by the App. */
  it('the mode → toolset table in 2-system.md is the human-readable form of mode_toolsets', () => {
    const doc = repoFile('docs/2-system.md');
    const section = doc.slice(doc.indexOf('### mode → toolset'), doc.indexOf('### Sessions'));
    const rows = [...section.matchAll(/^\| `([a-z_]+)`(?: \(([^)]*)\))? \|(.*)\|\s*$/gm)]
      .filter((row) => row[2] === undefined || row[2].startsWith('App-triggered'))
      .map((row) => {
        const cells = row[3].split('|').map((cell) => cell.trim());
        const bundlesOf = (server: 'notion' | 'gbrain' | 'app', cell: string): string[] =>
          [...cell.matchAll(/`([a-z_]+)`/g)]
            .map((match) => match[1])
            .filter((name) => name in toolsets[server].bundles);

        return [
          row[1],
          {
            notion: bundlesOf('notion', cells[0]),
            gbrain: bundlesOf('gbrain', cells[1]),
            app: bundlesOf('app', cells[2]),
          },
        ] as const;
      });

    expect(Object.fromEntries(rows)).toEqual(modeToolsets.rows);
  });

  /**
   * A zero reads budget for a server and a row without its bundles are one decision: otherwise a
   * mode would have tools it must not use, or a budget for tools it does not have.
   */
  it.each(Object.values(WorkflowMode))(
    "%s: the server's reads budget is zero if and only if the row has no bundles for the server",
    (mode) => {
      const budgets = canonical.retrievalBudgets();
      const own = budgets.per_mode[mode];
      const reads = {
        notion: own?.max_notion_tool_calls ?? budgets['max_notion_tool_calls'],
        gbrain: own?.max_gbrain_tool_calls ?? budgets['max_gbrain_tool_calls'],
      };
      const row = modeToolsets.rows[mode];

      expect({ notion: reads.notion === 0, gbrain: reads.gbrain === 0 }).toEqual({
        notion: row.notion.length === 0,
        gbrain: row.gbrain.length === 0,
      });
    },
  );

  it('no row grants a withheld capability or names an unknown tool', () => {
    const known = new Set(knownTools());

    for (const mode of Object.values(WorkflowMode)) {
      expect(allowedTools(mode).filter((tool) => !known.has(tool))).toEqual([]);
    }
  });

  /** The list of built-in tools cannot be complete, so it is reviewed at every SDK version bump. */
  it('the built-in list has been reviewed for the pinned SDK', () => {
    const pinned = z
      .object({ dependencies: z.record(z.string(), z.string()) })
      .parse(JSON.parse(repoFile('app/package.json'))).dependencies[
      '@anthropic-ai/claude-agent-sdk'
    ];

    expect(pinned).toBe(REVIEWED_FOR_SDK);
    expect(
      BUILT_IN_TOOLS.filter(
        (tool) =>
          HARNESS_TOOLS.includes(tool) || PLUGIN_TOOLS.includes(tool) || tool.startsWith('mcp__'),
      ),
    ).toEqual([]);
  });
});
