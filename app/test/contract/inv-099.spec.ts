import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDecorator } from 'typescript';
import { isImpureExpression } from './pure-layer';
import { importsOf, nodesIn, shippedSources, SRC, within } from './sources';

const KNOWLEDGE = resolve(SRC, 'knowledge');

/**
 * Files outside the layer that it needs: the canonical form of the Notion id, a pure function, and
 * the base class of App errors.
 */
const NOTION_ID = resolve(SRC, 'notion/client/notion-id.ts');
const APP_ERROR = resolve(SRC, 'platform/error/app-error.ts');
const OUTSIDE: ReadonlySet<string> = new Set([NOTION_ID, APP_ERROR]);

/**
 * Packages the layer rests on: the schemas that parse GBrain responses and the frontmatter
 * serialization.
 */
const PACKAGES: ReadonlySet<string> = new Set(['zod', 'yaml']);

/**
 * `INV-099` The GBrain knowledge rules are pure functions over the pages that were read:
 * `knowledge/` has no Nest providers and does not access GBrain, Notion, `app_db`, the network,
 * the clock or randomness, and imports only itself, the parsing schemas (`zod`), the frontmatter
 * serialization (`yaml`), the canonical form of the Notion id and the base class of App errors.
 *
 * The layer answers questions about pages that have already been read. It is not a tool of the
 * model, because the App MCP does not repeat what the person does through the GBrain MCP
 * (`INV-055`). GBrain is called by adapters at the edge — the gate and `anchors:check` — and the
 * layer remains what their reads are checked against.
 */
describe('INV-099', () => {
  const files = shippedSources(KNOWLEDGE);
  const imports = files.flatMap(importsOf);

  it('imports only itself, the parsing schemas, the frontmatter serialization, the canonical form of the Notion id and the error base class', () => {
    const foreign = imports
      .filter(({ target, edge }) => {
        if (target !== null) return !within(KNOWLEDGE, target) && !OUTSIDE.has(target);

        const specifier = edge.split(' → ')[1] ?? '';

        return !PACKAGES.has(specifier);
      })
      .map(({ edge }) => edge);

    expect(foreign).toEqual([]);
  });

  it('pure: no network, no process environment, no clock, no randomness', () => {
    const impure = files.flatMap((file) =>
      nodesIn(file, readFileSync(file, 'utf8'), isImpureExpression).map(({ at }) => at),
    );

    expect(impure).toEqual([]);
  });

  it('declares no Nest providers: the layer has no decorators', () => {
    const decorated = files.flatMap((file) =>
      nodesIn(file, readFileSync(file, 'utf8'), isDecorator).map(({ at }) => at),
    );

    expect(decorated).toEqual([]);
  });

  /** Otherwise an empty walk of the directory would pass the checks above silently. */
  it('finds the code and the imports it checks', () => {
    expect(files.map((file) => file.slice(KNOWLEDGE.length + 1))).toEqual(
      expect.arrayContaining(['anchor-page.ts', 'exact-identity.ts', 'gbrain-pages.ts']),
    );
    expect(imports.some(({ target }) => target === NOTION_ID)).toBe(true);
  });
});
