import { MODE_TOOLSETS } from '../../src/runs/toolsets';
import { canonical } from './contracts';

/** A read App tool, by name: everything the contract names starts with `get_` or `list_`. */
const READ_TOOL = /^(?:get|list)_/;

/**
 * `INV-096` The `closure_processing` mode writes only memory, through an App intent
 * (`memory_record`): it reads Notion and GBrain, and the rest of its App tools are reads.
 *
 * The perimeter is checked against the tool names that the contract lists. Extending a bundle or
 * adding a capability to the mode changes the answer here. The frame and the gate say what the run
 * remembers; the list of tools does not enforce that.
 */
describe('INV-096', () => {
  const row = canonical.modeToolsets().rows.closure_processing;
  const { app, gbrain, notion } = canonical.mcpToolsets();

  const toolsOf = (
    server: { capabilities: Record<string, string[]>; bundles: Record<string, string[]> },
    bundles: readonly string[],
  ): string[] =>
    bundles.flatMap((bundle) =>
      (server.bundles[bundle] ?? []).flatMap((capability) => server.capabilities[capability] ?? []),
    );

  it('the mode row exists and the code mirrors the contract', () => {
    expect(row).toBeDefined();
    expect(MODE_TOOLSETS.closure_processing).toEqual(row);
  });

  it('Notion is read-only', () => {
    expect(row.notion).toEqual(['read']);
    expect(Object.keys(notion.bundles)).toContain('read');
  });

  it('GBrain is read-only', () => {
    expect(row.gbrain).toEqual(['read']);
    expect(Object.keys(gbrain.bundles)).toContain('read');
  });

  it("the mode's only write is a memory write by a system intent; the other App tools are read tools", () => {
    const tools = toolsOf(app, row.app);
    const voiced = (app.system_voice ?? []).flatMap((capability) => app.capabilities[capability]);
    const memory = app.capabilities['memory_record'] ?? [];

    expect(memory).toEqual(['record_memory']);
    expect(tools.filter((tool) => voiced.includes(tool))).toEqual(memory);
    expect(tools.filter((tool) => !READ_TOOL.test(tool) && !memory.includes(tool))).toEqual([]);
  });
});
