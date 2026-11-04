import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { composeFile } from './contracts';
import { shippedSources, SRC, within } from './sources';

/**
 * The variables of the deterministic Notion REST credential (`docs/2-system.md` § “Configuration
 * contract App”).
 */
const REST_NAMES = ['NOTION_API_TOKEN', 'NOTION_API_VERSION'] as const;

/** A REST variable name as a word: in quotes, in `process.env` or anywhere else. */
const REST = new RegExp(`\\b(${REST_NAMES.join('|')})\\b`, 'g');

/** The Notion MCP grant variables: the `NOTION_MCP_*` prefix is reserved for it. */
const MCP = /\bNOTION_MCP_[A-Z_]+\b/g;

const DECLARATION = resolve(SRC, 'config/env.validation.ts');
const REST_READER = resolve(SRC, 'notion/client');
const MCP_READER = resolve(SRC, 'credentials/notion-mcp');

interface Reader {
  readonly file: string;
  readonly rest: boolean;
  readonly mcp: boolean;
}

function readers(): Reader[] {
  return shippedSources(SRC)
    .filter((file) => file !== DECLARATION)
    .map((file) => {
      const text = readFileSync(file, 'utf8');

      return {
        file,
        rest: [...text.matchAll(REST)].length > 0,
        mcp: [...text.matchAll(MCP)].length > 0,
      };
    });
}

/**
 * `INV-060`: Notion MCP OAuth for App-triggered runs is separate from the deterministic Notion REST
 * integration credential.
 *
 * Two sources and no shared variable: the REST credential is read only by the Notion client, the
 * MCP grant only by its service, and Compose does not build one from the other. The MCP grant is
 * not a variable at all: it lives in `connector_credentials`.
 */
describe('INV-060', () => {
  const all = readers();

  it('only the Notion client reads the REST credential', () => {
    const outside = all
      .filter((reader) => reader.rest && !within(REST_READER, reader.file))
      .map((reader) => relative(SRC, reader.file));

    expect(outside).toEqual([]);
  });

  it('only its service reads the MCP grant configuration', () => {
    const outside = all
      .filter((reader) => reader.mcp && !within(MCP_READER, reader.file))
      .map((reader) => relative(SRC, reader.file));

    expect(outside).toEqual([]);
  });

  it('no file reads both', () => {
    expect(all.filter((reader) => reader.rest && reader.mcp)).toEqual([]);
  });

  it('Compose does not build an MCP variable from REST variables', () => {
    const environment = composeFile('infra/compose.yaml').services.app?.environment ?? {};
    const mcp = Object.entries(environment).filter(([name]) => name.startsWith('NOTION_MCP_'));

    expect(mcp.length).toBeGreaterThan(0);
    expect(mcp.filter(([, value]) => REST_NAMES.some((name) => value.includes(name)))).toEqual([]);
  });

  /** Without this, a scanner that finds nothing would pass the checks above silently. */
  it('finds both readers', () => {
    expect(all.some((reader) => reader.rest && within(REST_READER, reader.file))).toBe(true);
    expect(all.some((reader) => reader.mcp && within(MCP_READER, reader.file))).toBe(true);
  });
});
