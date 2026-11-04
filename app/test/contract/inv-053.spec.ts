import { allowedTools } from '../../src/claude/perimeter';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { MCP_TOOLSETS } from '../../src/runs/toolsets';

/**
 * `INV-053` The Notion MCP is the person's voice: Notion attributes to the person whatever Claude
 * writes through it. So an App run only reads through it and writes in the system's voice,
 * through the App: a comment, the conversion of an Inbox item.
 */
const notion = (capability: string): string[] =>
  (MCP_TOOLSETS.notion.capabilities[capability] ?? []).map((tool) => `mcp__notion__${tool}`);

const modes = Object.values(WorkflowMode);

describe('INV-053', () => {
  it.each(modes)('%s: the run is not given Notion MCP comment writes', (mode) => {
    expect(allowedTools(mode).filter((tool) => notion('comments_write').includes(tool))).toEqual(
      [],
    );
  });

  it('Notion MCP comment writes are withheld with a reason, not forgotten', () => {
    expect(MCP_TOOLSETS.notion.withheld).toContain('comments_write');
  });

  it('no run is given page writes through the Notion MCP', () => {
    const pageWrites = [...notion('page_create'), ...notion('page_update')];
    const writers = modes.filter((mode) =>
      allowedTools(mode).some((tool) => pageWrites.includes(tool)),
    );

    expect(writers).toEqual([]);
  });

  it('Notion MCP page writes are withheld with a reason, not forgotten', () => {
    expect(MCP_TOOLSETS.notion.withheld).toEqual(
      expect.arrayContaining(['page_create', 'page_update']),
    );
  });
});
