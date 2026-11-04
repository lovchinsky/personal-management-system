import { CHAT_TOOLSET, chatTools, MCP_TOOLSETS } from '../../src/runs/toolsets';
import { chatMcpSurface } from './app-mcp.surface';
import { canonical } from './contracts';

/**
 * `INV-313` The toolset of App tools on the Chat path contains neither `add_comment` (the person's
 * voice in the chat goes through the Notion MCP) nor `create_pending_action`: a proposal from the
 * chat left unanswered in the same turn stays an Inbox item (`INV-015`).
 *
 * The tests check the contract, its mirror in the code and what the server actually shows the
 * chat: the person chooses the Notion and GBrain toolset in the chat, whereas the App tools are
 * determined by the App itself.
 */
describe('INV-313', () => {
  const contract = canonical.chatToolset();

  it('the mirror in the code matches the contract', () => {
    expect([...CHAT_TOOLSET.app]).toEqual(contract.app);
  });

  it("the chat gets neither a comment in the system's voice nor a proposal", () => {
    expect(contract.app).not.toContain('comment_write');
    expect(contract.app).not.toContain('approval_propose');
    expect(Object.keys(contract.excluded).sort()).toEqual(['approval_propose', 'comment_write']);
    expect(chatTools()).not.toContain('add_comment');
    expect(chatTools()).not.toContain('create_pending_action');
  });

  it('every named capability exists in the App', () => {
    const known = Object.keys(MCP_TOOLSETS.app.capabilities);

    expect(contract.app.filter((capability) => !known.includes(capability))).toEqual([]);
    expect(
      Object.keys(contract.excluded).filter((capability) => !known.includes(capability)),
    ).toEqual([]);
  });

  it('the server shows the chat exactly the `chat_toolset`', async () => {
    const { tools } = await chatMcpSurface();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...chatTools()].sort());
  });

  /**
   * A person's decision is a step in which the person speaks for themselves, so a run does not get
   * it under any row of the matrix.
   */
  it('deciding on a proposal and parking an Inbox item belong only to the chat', () => {
    const runTools = Object.values(MCP_TOOLSETS.app.bundles)
      .flat()
      .flatMap((capability) => MCP_TOOLSETS.app.capabilities[capability] ?? []);

    expect(runTools).not.toContain('decide_pending_action');
    expect(runTools).not.toContain('park_inbox_item');
    expect(chatTools()).toEqual(
      expect.arrayContaining(['decide_pending_action', 'park_inbox_item', 'close_inbox_item']),
    );
  });
});
