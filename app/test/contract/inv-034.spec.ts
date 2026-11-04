import { allowedTools } from '../../src/claude/perimeter';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { bundleTools } from '../../src/runs/toolsets';

/**
 * `INV-034` On detector paths the Notion MCP only reads: the system writes the comment through the
 * App, and a property change goes through `pending_actions`. The capture path `dialogue` also
 * only reads: a Task from an Inbox item is created by the conversion through the App.
 */
const notionRead = new Set(bundleTools('notion', 'read').map((tool) => `mcp__notion__${tool}`));
const detectorModes = Object.values(WorkflowMode).filter((mode) => mode !== WorkflowMode.dialogue);

describe('INV-034', () => {
  it.each(detectorModes)('%s: Notion allows only reads', (mode) => {
    const writes = allowedTools(mode).filter(
      (tool) => tool.startsWith('mcp__notion__') && !notionRead.has(tool),
    );

    expect(writes).toEqual([]);
  });

  it('no run writes pages through the Notion MCP, the capture path included', () => {
    const pageWriters = Object.values(WorkflowMode).filter((mode) =>
      allowedTools(mode).some(
        (tool) =>
          tool === 'mcp__notion__notion-update-page' || tool === 'mcp__notion__notion-create-pages',
      ),
    );

    expect(pageWriters).toEqual([]);
  });
});
