import { CHAT_TOOLSET, MCP_TOOLSETS } from '../../src/runs/toolsets';
import { everyAppMcpTool } from './app-mcp.surface';

/** The names that `INV-028` lists one by one. */
const FORBIDDEN = [
  'create_task',
  'update_project',
  'notion_raw_request',
  'write_gbrain_fact',
  'append_gbrain_timeline',
  'gbrain_raw_request',
  'sql_query',
] as const;

/**
 * `INV-028` The App MCP contains none of the names `create_task`, `update_project`,
 * `notion_raw_request`, `write_gbrain_fact`, `append_gbrain_timeline`, `gbrain_raw_request`,
 * `sql_query` or their equivalents.
 *
 * The list of names is checked mechanically. “Equivalents” are not: that tail is covered by
 * `INV-025` (manual). What can be checked mechanically instead is that the App MCP shows exactly
 * the tools that the contract assigns to its capabilities, and nothing beyond them.
 */
describe('INV-028', () => {
  it('none of the listed names is among the App MCP tools', async () => {
    const names = (await everyAppMcpTool()).map((tool) => tool.name);

    expect(names.filter((name) => FORBIDDEN.some((forbidden) => forbidden === name))).toEqual([]);
  });

  /**
   * Capabilities withheld from runs — the person's decision and parking an Inbox item — do not
   * disappear: the chat shows them (`chat_toolset`). Only what is named neither in a bundle nor in
   * the chat toolset is shown to no one.
   */
  it('the App MCP shows exactly the tools of the capabilities someone receives', async () => {
    const app = MCP_TOOLSETS.app;
    const granted = Object.entries(app.capabilities)
      .filter(
        ([capability]) =>
          !app.withheld.includes(capability) || CHAT_TOOLSET.app.includes(capability),
      )
      .flatMap(([, tools]) => tools);

    expect((await everyAppMcpTool()).map((tool) => tool.name).sort()).toEqual([...granted].sort());
  });
});
