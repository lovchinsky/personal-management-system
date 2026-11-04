import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { everyAppMcpTool } from './app-mcp.surface';
import { shippedSources, SRC } from './sources';

const MCP = resolve(SRC, 'mcp');

/** Paths to raw SQL in Prisma. */
const RAW_SQL = /\$(?:queryRaw|executeRaw)(?:Unsafe)?\b/;

/** Fields a database query can hide in. */
const SQL_FIELDS = /^(?:sql|query|statement|where|raw)$/i;

/**
 * `INV-056` The App MCP never exposes raw SQL.
 *
 * `INV-028` forbids the name `sql_query`, but this test covers the possibility of raw SQL itself.
 * No tool accepts a field that can hold a query, and the App MCP code has no path to raw SQL at
 * all: it reaches the database only through capability services.
 */
describe('INV-056', () => {
  it('no tool accepts a field for a query', async () => {
    const fields = (await everyAppMcpTool()).flatMap((tool) =>
      Object.keys(tool.inputSchema.properties ?? {})
        .filter((field) => SQL_FIELDS.test(field))
        .map((field) => `${tool.name}.${field}`),
    );

    expect(fields).toEqual([]);
  });

  it('no tool name mentions SQL', async () => {
    expect((await everyAppMcpTool()).filter((tool) => /sql/i.test(tool.name))).toEqual([]);
  });

  it('the mcp/ code writes no raw SQL', () => {
    const raw = shippedSources(MCP)
      .filter((file) => RAW_SQL.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));

    expect(raw).toEqual([]);
  });
});
