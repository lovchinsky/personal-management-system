import { everyAppMcpTool } from './app-mcp.surface';

/**
 * A JSON Schema node, limited to what the check reads: an object, its fields, array items and
 * variants.
 */
interface SchemaNode {
  readonly type?: unknown;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly additionalProperties?: unknown;
  readonly items?: SchemaNode;
  readonly oneOf?: readonly SchemaNode[];
  readonly anyOf?: readonly SchemaNode[];
  readonly allOf?: readonly SchemaNode[];
}

/** Returns the paths to schema objects that accept fields they do not know. */
function openObjects(node: SchemaNode, path: string): string[] {
  const own = node.type === 'object' && node.additionalProperties !== false ? [path] : [];
  const nested = [
    ...Object.entries(node.properties ?? {}).flatMap(([name, child]) =>
      openObjects(child, `${path}.${name}`),
    ),
    ...(node.items ? openObjects(node.items, `${path}[]`) : []),
    ...[...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? [])].flatMap(
      (variant, index) => openObjects(variant, `${path}|${index}`),
    ),
  ];

  return [...own, ...nested];
}

/**
 * `INV-090` App MCP tools have closed input schemas: a field the schema does not recognize gets a
 * refusal, not silence.
 *
 * The check runs against the published schema, the one the model sees in `tools/list`, not the zod
 * schema in the code, because the MCP server refuses based on the published schema, and a
 * divergence between the two would mean that the model sees one thing while something else is
 * checked.
 */
describe('INV-090', () => {
  it('every object in the input schema of every tool is closed', async () => {
    const open = (await everyAppMcpTool()).flatMap((tool) =>
      openObjects(tool.inputSchema, tool.name),
    );

    expect(open).toEqual([]);
  });

  /** Otherwise a check blind to nested objects would pass silently. */
  it('the check finds an open object and a nested one too', () => {
    const leaky: SchemaNode = {
      type: 'object',
      additionalProperties: false,
      properties: {
        effects: { type: 'array', items: { type: 'object', properties: {} } },
        value: { oneOf: [{ type: 'object', additionalProperties: false }, { type: 'object' }] },
      },
    };

    expect(openObjects(leaky, 'tool')).toEqual(['tool.effects[]', 'tool.value|1']);
  });

  it('finds the tools it checks', async () => {
    expect((await everyAppMcpTool()).length).toBeGreaterThan(0);
  });
});
