import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { appMcpSurface } from './app-mcp.surface';
import { shippedSources, SRC } from './sources';

const MCP = resolve(SRC, 'mcp');

/** Registration of MCP prompts and resources — in every form of the server API. */
const PROMPTS_OR_RESOURCES = /\.(?:registerPrompt|registerResource|prompt|resource)\(/;

/**
 * `INV-066` The core App-triggered MCP integration depends on tool calls, not on MCP
 * prompts/resources.
 *
 * On the App MCP side, the server declares only tools, both in the code and in what the client
 * sees on `initialize`. The runner side (that a run does not read resources) is the perimeter's
 * job: the built-in tools for resources are forbidden in a run.
 */
describe('INV-066', () => {
  it.each(Object.values(WorkflowMode))('the server for %s declares only tools', async (mode) => {
    const { capabilities } = await appMcpSurface(mode);

    expect(Object.keys(capabilities).filter((capability) => capability !== 'tools')).toEqual([]);
  });

  it('the mcp/ code registers no prompts or resources', () => {
    const registering = shippedSources(MCP)
      .filter((file) => PROMPTS_OR_RESOURCES.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));

    expect(registering).toEqual([]);
  });
});
