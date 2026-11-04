import { parse } from 'yaml';
import {
  anchorSlug,
  checkAnchor,
  renderAnchor,
  type AnchorSpec,
} from '../../src/knowledge/anchor-page';
import {
  ANCHOR_TYPES,
  FORBIDDEN_FRONTMATTER_KEYS,
  IDENTITY_LINE_LABEL,
  isAnchorType,
  SLUG_PREFIXES,
  type AnchorType,
} from '../../src/knowledge/anchor-types';
import { pageFromContent } from '../fixtures/gbrain-pages.fixture';
import { canonical } from './contracts';
import { entryText } from './plugin-files';

/**
 * `INV-097` A canonical anchor is a GBrain page that follows the `gbrain_anchor_shape`
 * convention: the slug `<type prefix>/<notion_id without hyphens>`, frontmatter with `type`,
 * `title`, `notion_id` in the canonical form and `aliases`, without an `id` key, and in the body
 * an identity line with the same id.
 *
 * The convention lives in the contract and the code mirrors it in constants. The test compares the
 * two, and a divergence in either direction fails it.
 */
describe('INV-097', () => {
  const shape = canonical.gbrainAnchorShape();

  it('the anchor types in the code are exactly those of the key gbrain_anchor_types', () => {
    expect([...ANCHOR_TYPES]).toEqual(canonical.gbrainAnchorTypes());
  });

  it('the slug prefixes are exactly those of the contract, for every type', () => {
    expect(SLUG_PREFIXES).toEqual(shape.slug_prefixes);
  });

  it('the forbidden frontmatter keys and the label of the identity line match the contract', () => {
    expect([...FORBIDDEN_FRONTMATTER_KEYS]).toEqual(shape.forbidden_frontmatter_keys);
    expect(`${IDENTITY_LINE_LABEL} <notion_id>`).toBe(shape.identity_line);
  });

  it('a built anchor has exactly the frontmatter fields that the contract names', () => {
    const { example } = shape;
    const type = toAnchorType(example.type);
    const content: string = renderAnchor({
      type,
      title: example.title,
      notionId: example.notion_id,
      aliases: example.aliases,
      paragraphs: [],
    });
    const frontmatter: unknown = parse(/^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '');

    expect(Object.keys(recordOf(frontmatter)).sort()).toEqual([...shape.fields].sort());
  });

  it('parsing accepts an anchor built from the contract example by the convention as conforming', () => {
    const { example } = shape;
    const type = toAnchorType(example.type);
    const spec: AnchorSpec = {
      type,
      title: example.title,
      notionId: example.notion_id,
      aliases: example.aliases,
      paragraphs: [],
    };
    const page = pageFromContent(anchorSlug(type, example.notion_id), renderAnchor(spec));

    expect(checkAnchor(page)).toEqual([]);
  });

  it('every anchor type is built according to the convention', () => {
    for (const type of ANCHOR_TYPES) {
      const page = pageFromContent(
        anchorSlug(type, shape.example.notion_id),
        renderAnchor({
          type,
          title: shape.example.title,
          notionId: shape.example.notion_id,
          aliases: [],
          paragraphs: [],
        }),
      );

      expect(checkAnchor(page)).toEqual([]);
    }
  });

  /**
   * A row of the anchor table in the knowledge file: Notion object, page type, directory of its
   * address.
   */
  it('the Skill lists the type and directory of each anchor for the agent as a pair, as the contract declares them', () => {
    const memory: string = entryText(canonical.pluginEntries().chat, 'knowledge/memory.md');
    const rows: [string, string][] = [
      ...memory.matchAll(/^\| [^|`]+ \| `(\w+)` \| `([\w-]+)` \|$/gm),
    ].map((match): [string, string] => [match[1] ?? '', match[2] ?? '']);
    const declared: [string, string][] = ANCHOR_TYPES.map((type): [string, string] => [
      type,
      shape.slug_prefixes[type] ?? '',
    ]);

    expect(rows).toEqual(declared);
  });
});

function toAnchorType(value: string): AnchorType {
  if (!isAnchorType(value)) throw new Error(`${value} is not an anchor type`);

  return value;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('the frontmatter is not a block of keys');
  }

  return Object.fromEntries(Object.entries(value));
}
