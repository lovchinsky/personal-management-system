import { ALPHA_ID, pageFromContent, pageRead } from '../../test/fixtures/gbrain-pages.fixture';
import {
  anchorSlug,
  checkAnchor,
  describeAnchor,
  renderAnchor,
  type AnchorDescription,
  type AnchorSpec,
  type AnchorViolation,
} from './anchor-page';
import { ANCHOR_TYPES } from './anchor-types';

const SPEC: AnchorSpec = {
  type: 'project',
  title: 'Launch Alpha',
  notionId: ALPHA_ID,
  aliases: ['Alpha launch', 'Product Alpha'],
  paragraphs: ['Shipping the alpha to design partners.'],
};

const codes = (violations: readonly AnchorViolation[]): string[] =>
  violations.map(({ code }) => code);

describe('anchorSlug', () => {
  it('consists of the type prefix and the id without hyphens, in lowercase', () => {
    const slug: string = anchorSlug('area_of_focus', ALPHA_ID.toUpperCase());

    expect(slug).toBe('areas-of-focus/a08651846cda69f0e8e03884c8610ce5');
  });

  it('has a prefix for every anchor type, and the prefixes differ', () => {
    const prefixes: string[] = ANCHOR_TYPES.map(
      (type) => anchorSlug(type, ALPHA_ID).split('/')[0] ?? '',
    );

    expect(new Set(prefixes).size).toBe(ANCHOR_TYPES.length);
  });

  it('refuses a string that is not a Notion id', () => {
    expect(() => anchorSlug('project', 'launch-alpha')).toThrow(RangeError);
  });
});

describe('renderAnchor', () => {
  it('builds a page the parser finds conforming and describes with the same description', () => {
    for (const type of ANCHOR_TYPES) {
      const spec: AnchorSpec = { ...SPEC, type };
      const page = pageFromContent(anchorSlug(type, ALPHA_ID), renderAnchor(spec));
      const description: AnchorDescription | null = describeAnchor(page);

      expect(checkAnchor(page)).toEqual([]);
      expect(description).toEqual({
        type,
        title: spec.title,
        notionId: ALPHA_ID,
        aliases: spec.aliases,
      });
    }
  });

  it('puts the id in the frontmatter and in the body, and adds no id key', () => {
    const content: string = renderAnchor(SPEC);
    const page = pageFromContent(anchorSlug('project', ALPHA_ID), content);

    expect(page.frontmatter['notion_id']).toBe(ALPHA_ID);
    expect(page.compiledTruth).toContain(`Notion: ${ALPHA_ID}`);
    expect(Object.keys(page.frontmatter)).not.toContain('id');
  });

  it('keeps a title with a colon, quotes and a hash as a value', () => {
    const title = 'Launch: "Alpha" #1';
    const page = pageFromContent(anchorSlug('project', ALPHA_ID), renderAnchor({ ...SPEC, title }));

    expect(page.title).toBe(title);
    expect(checkAnchor(page)).toEqual([]);
  });

  it('accepts an id in any form and writes the canonical one', () => {
    const page = pageFromContent(
      anchorSlug('project', ALPHA_ID),
      renderAnchor({ ...SPEC, notionId: ALPHA_ID.replaceAll('-', '').toUpperCase() }),
    );

    expect(page.frontmatter['notion_id']).toBe(ALPHA_ID);
  });

  it('refuses an id that is not a Notion id', () => {
    expect(() => renderAnchor({ ...SPEC, notionId: 'alpha' })).toThrow(RangeError);
  });
});

describe('checkAnchor: every problem is named separately', () => {
  const conforming = pageFromContent(anchorSlug('project', ALPHA_ID), renderAnchor(SPEC));

  it('a page that follows the convention has no problems', () => {
    expect(checkAnchor(conforming)).toEqual([]);
  });

  it.each<[string, Partial<typeof conforming>, string[]]>([
    ['a type that is not an anchor type', { type: 'note' }, ['type_not_anchor']],
    ['no notion_id', { frontmatter: { aliases: [] } }, ['notion_id_missing']],
    [
      'notion_id is not an id',
      { frontmatter: { notion_id: 'alpha', aliases: [] } },
      ['notion_id_invalid'],
    ],
    [
      'notion_id without hyphens',
      { frontmatter: { notion_id: ALPHA_ID.replaceAll('-', ''), aliases: [] } },
      ['notion_id_not_canonical'],
    ],
    [
      'an id key in the frontmatter',
      { frontmatter: { notion_id: ALPHA_ID, aliases: [], id: 'x' } },
      ['forbidden_key'],
    ],
    ['no aliases', { frontmatter: { notion_id: ALPHA_ID } }, ['aliases_missing']],
    ['a slug not derived from the id', { slug: 'projects/launch-alpha' }, ['slug_mismatch']],
    ['an empty title', { title: ' ' }, ['title_empty']],
    [
      'aliases is not a list of strings',
      { frontmatter: { notion_id: ALPHA_ID, aliases: [1] } },
      ['aliases_invalid'],
    ],
    ['no identity line', { compiledTruth: '# Launch Alpha' }, ['identity_line_missing']],
    [
      'a “Notion:” line with a link instead of an id is not an identity line',
      { compiledTruth: '# Launch Alpha\n\nNotion: https://www.notion.so/Launch-Alpha' },
      ['identity_line_missing'],
    ],
    [
      'a label without a value and a word on the next line is not an identity line',
      { compiledTruth: '# Launch Alpha\n\nNotion:\nWorkspace' },
      ['identity_line_missing'],
    ],
    [
      'an identity line with a foreign id',
      { compiledTruth: '# Launch Alpha\n\nNotion: 6da95a57-78ae-72fc-a71d-23a267cf2aa6' },
      ['identity_line_mismatch'],
    ],
  ])('%s', (_name, overrides, expected) => {
    const page = { ...conforming, ...overrides };

    expect(codes(checkAnchor(page))).toEqual(expected);
  });
});

describe('describeAnchor', () => {
  it('returns `null` for a page that does not say whose it is', () => {
    expect(describeAnchor(pageRead({ type: 'note' }))).toBeNull();
    expect(describeAnchor(pageRead({ frontmatter: {} }))).toBeNull();
    expect(describeAnchor(pageRead({ frontmatter: { notion_id: 'alpha' } }))).toBeNull();
  });

  it('reads an id in any form as the canonical one', () => {
    const description = describeAnchor(
      pageRead({ frontmatter: { notion_id: ALPHA_ID.replaceAll('-', '').toUpperCase() } }),
    );

    expect(description?.notionId).toBe(ALPHA_ID);
  });
});
