import { CHAT_TOOLSET, MCP_TOOLSETS } from '../../src/runs/toolsets';
import { everyAppMcpTool } from './app-mcp.surface';

/**
 * The seven App MCP classes (`docs/2-system.md` § “App MCP — runtime/control interface”).
 */
const CLASSES = [
  'attention',
  'capture',
  'continuation',
  'delivery',
  'approval',
  'memory',
  'introspection',
] as const;

/**
 * Domain nouns that belong to Notion and GBrain. An App MCP tool that names any of them most
 * likely does what a domain MCP can already do.
 */
const DOMAIN_NOUNS =
  /(?:^|_)(?:task|project|objective|key_result|area|behavior|page|database|comment|property|fact|timeline|link|entity|knowledge|notion|gbrain)(?:_|s?$)/;

/**
 * `SCEN-19-51`: an App MCP tool that duplicates a Notion or GBrain domain write fails
 * architecture acceptance. `SCEN-19-51` belongs with `SCEN-64-16` (the App MCP exposes only
 * runtime/control capabilities and a closed list of system intents) and `SCEN-64-17`
 * (no domain-write facade).
 *
 * The voice chooses the interface (ADR 0017, ADR 0035): a write on the person's behalf stays in
 * the domain MCP, and on its own behalf the system writes to Notion and GBrain only through the
 * App, using a closed list of intents (`contracts/canonical.yaml`, key `mcp_toolsets`). The rule
 * can be checked mechanically in three ways: every App tool belongs to one of its classes, none
 * coincides by name with a Notion or GBrain tool, and only the system's intents name a Notion or
 * GBrain subject.
 */
describe('SCEN-19-51', () => {
  it('every App MCP tool belongs to one of the seven classes', async () => {
    const app = MCP_TOOLSETS.app;
    // Capabilities withheld from runs belong to classes too: the chat shows them.
    const inChatOnly = CHAT_TOOLSET.app.filter((capability) => app.withheld.includes(capability));
    const classed = new Set([
      ...CLASSES.flatMap((bundle) =>
        (app.bundles[bundle] ?? []).flatMap((capability) => app.capabilities[capability] ?? []),
      ),
      ...inChatOnly.flatMap((capability) => app.capabilities[capability] ?? []),
    ]);

    expect(inChatOnly.sort()).toEqual(['approval_decide', 'capture_park']);
    expect((await everyAppMcpTool()).filter((tool) => !classed.has(tool.name))).toEqual([]);
  });

  it('no App MCP tool repeats a Notion or GBrain tool', async () => {
    const domain = new Set(
      (['notion', 'gbrain'] as const).flatMap((server) => [
        ...Object.values(MCP_TOOLSETS[server].capabilities).flat(),
        ...MCP_TOOLSETS[server].untriaged,
      ]),
    );

    expect((await everyAppMcpTool()).filter((tool) => domain.has(tool.name))).toEqual([]);
  });

  it('only the system intents name a Notion or GBrain subject', async () => {
    const app = MCP_TOOLSETS.app;
    const voiced = new Set(
      app.systemVoice.flatMap((capability) => app.capabilities[capability] ?? []),
    );

    expect(
      (await everyAppMcpTool())
        .map((tool) => tool.name)
        .filter((name) => DOMAIN_NOUNS.test(name) && !voiced.has(name)),
    ).toEqual([]);
  });

  /**
   * The system's intents are a closed list: each new intent is a decision about the system's
   * voice (ADR 0017), not a consequence of a new tool.
   */
  it('the system intents are a closed list', () => {
    expect([...MCP_TOOLSETS.app.systemVoice]).toEqual([
      'comment_write',
      'capture_convert',
      'capture_close',
      'memory_record',
    ]);
  });

  /** Without this, an empty list of tools would pass the checks above silently. */
  it('finds the tools it checks', async () => {
    expect((await everyAppMcpTool()).length).toBeGreaterThan(0);
  });
});
