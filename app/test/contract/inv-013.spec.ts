import { CAPTURING } from '../fixtures/actors';
import { A_CONVERSION, CaptureWorld, converted, INBOX_ITEM } from '../fixtures/capture-world';
import { everyAppMcpTool } from './app-mcp.surface';

/**
 * `INV-013` Moving the source item to the trash does not need a separate approval: “this becomes
 * X” and the removal of the source are one intent.
 *
 * The move to the trash is the last step of the conversion itself, not a separate action. The App
 * MCP has no trashing tool of its own, so outside a conversion a run has no way to trash a page.
 */
describe('INV-013', () => {
  it('a conversion moves the item to the trash with the same intent', async () => {
    const world = new CaptureWorld();
    const service = await world.service();

    await converted(service, await service.check(CAPTURING, A_CONVERSION));

    expect(world.writes.at(-1)).toEqual({ op: 'archive', pageId: INBOX_ITEM });
  });

  it('the App MCP has no separate tool for moving a page to the trash', async () => {
    const names = (await everyAppMcpTool()).map((tool) => tool.name);

    expect(names.filter((name) => /archive|trash|delete/.test(name))).toEqual([]);
  });
});
