import { ALPHA_ID, BETA_ID, pageRead } from '../../test/fixtures/gbrain-pages.fixture';
import { anchorSlug } from './anchor-page';
import {
  anchorPlacement,
  candidateSlugs,
  resolveAnchor,
  slugsToRead,
  type AnchorIdentity,
  type AnchorPlacement,
} from './exact-identity';
import type { PageRead, SearchHit } from './gbrain-pages';

const hit = (slug: string, overrides: Partial<SearchHit> = {}): SearchHit => ({
  slug,
  title: slug,
  type: 'project',
  evidence: 'keyword_exact',
  ...overrides,
});

const anchor = (slug: string, notionId: string, overrides: Partial<PageRead> = {}): PageRead =>
  pageRead({ slug, frontmatter: { notion_id: notionId }, ...overrides });

describe('candidateSlugs', () => {
  it('selects pages of anchor types marked as exact matches, once each', () => {
    const hits: SearchHit[] = [
      hit('projects/a'),
      hit('projects/a'),
      hit('areas-of-focus/b', { type: 'area_of_focus' }),
    ];

    expect(candidateSlugs(hits)).toEqual(['projects/a', 'areas-of-focus/b']);
  });

  it('filters out a page that is only similar, because search returns the closest page even if none contains the id', () => {
    expect(candidateSlugs([hit('projects/near', { evidence: 'weak_semantic' })])).toEqual([]);
    expect(candidateSlugs([hit('projects/near', { evidence: null })])).toEqual([]);
  });

  it('filters out a page of another type that only mentions the id', () => {
    expect(candidateSlugs([hit('lessons/escalation', { type: 'note' })])).toEqual([]);
  });
});

describe('resolveAnchor', () => {
  const slug: string = anchorSlug('project', ALPHA_ID);

  it('no candidates yield `absent`', () => {
    expect(resolveAnchor(ALPHA_ID, [])).toEqual<AnchorIdentity>({ state: 'absent' });
  });

  it('one page with this notion_id yields `exact`', () => {
    expect(resolveAnchor(ALPHA_ID, [anchor(slug, ALPHA_ID)])).toEqual<AnchorIdentity>({
      state: 'exact',
      slug,
    });
  });

  it('two pages with this notion_id yield `integrity_error`, and none is chosen', () => {
    const result: AnchorIdentity = resolveAnchor(ALPHA_ID, [
      anchor('projects/launch-alpha', ALPHA_ID),
      anchor(slug, ALPHA_ID),
    ]);

    expect(result).toEqual({
      state: 'integrity_error',
      slugs: [slug, 'projects/launch-alpha'],
    });
  });

  it('the order of the candidates does not affect the answer', () => {
    const pages: PageRead[] = [anchor('projects/b', ALPHA_ID), anchor('projects/a', ALPHA_ID)];

    expect(resolveAnchor(ALPHA_ID, pages)).toEqual(resolveAnchor(ALPHA_ID, [...pages].reverse()));
  });

  it('a page of another object is a candidate but not the anchor for this id', () => {
    expect(resolveAnchor(ALPHA_ID, [anchor('projects/beta', BETA_ID)])).toEqual({
      state: 'absent',
    });
  });

  it('a page of a non-anchor type with this notion_id is not an anchor', () => {
    expect(resolveAnchor(ALPHA_ID, [anchor('notes/alpha', ALPHA_ID, { type: 'note' })])).toEqual({
      state: 'absent',
    });
  });

  it('a deleted page is not an anchor', () => {
    expect(resolveAnchor(ALPHA_ID, [anchor(slug, ALPHA_ID, { deleted: true })])).toEqual({
      state: 'absent',
    });
  });

  it('an id is compared as an id, not as its spelling', () => {
    const undashed: string = ALPHA_ID.replaceAll('-', '').toUpperCase();

    expect(resolveAnchor(undashed, [anchor(slug, ALPHA_ID)])).toEqual({ state: 'exact', slug });
    expect(resolveAnchor(ALPHA_ID, [anchor(slug, undashed)])).toEqual({ state: 'exact', slug });
  });

  it('one page read twice does not form a duplicate', () => {
    expect(resolveAnchor(ALPHA_ID, [anchor(slug, ALPHA_ID), anchor(slug, ALPHA_ID)])).toEqual({
      state: 'exact',
      slug,
    });
  });

  it('refuses a string that is not a Notion id', () => {
    expect(() => resolveAnchor('launch-alpha', [])).toThrow(RangeError);
  });
});

describe('slugsToRead', () => {
  const conventional = anchorSlug('project', ALPHA_ID);

  it('an empty search response leaves the page at the conventional address, because search may lag behind a write', () => {
    expect(slugsToRead([], 'project', ALPHA_ID)).toEqual([conventional]);
  });

  it('exact matches are added to the address, and a match that is already the address is not read twice', () => {
    expect(
      slugsToRead(
        [
          hit(conventional),
          hit('projects/copy'),
          hit('projects/near', { evidence: 'weak_semantic' }),
        ],
        'project',
        ALPHA_ID,
      ),
    ).toEqual([conventional, 'projects/copy']);
  });

  it('the address depends on the object type and not on how the id is written', () => {
    expect(slugsToRead([], 'area_of_focus', ALPHA_ID.toUpperCase())).toEqual([
      anchorSlug('area_of_focus', ALPHA_ID),
    ]);
  });
});

describe('anchorPlacement', () => {
  const slug: string = anchorSlug('project', ALPHA_ID);

  it('when an anchor exists, the write lands on it', () => {
    const expected: AnchorPlacement = { state: 'exact', slug };

    expect(anchorPlacement('project', ALPHA_ID, [anchor(slug, ALPHA_ID)])).toEqual(expected);
  });

  it('with no anchor and a free address, an anchor is created at the conventional address', () => {
    const expected: AnchorPlacement = { state: 'create', slug };

    expect(anchorPlacement('project', ALPHA_ID, [])).toEqual(expected);
  });

  it('a page at the address that is not an anchor of this object occupies the address', () => {
    const expected: AnchorPlacement = { state: 'occupied', slug };

    expect(anchorPlacement('project', ALPHA_ID, [anchor(slug, BETA_ID)])).toEqual(expected);
    expect(
      anchorPlacement('project', ALPHA_ID, [pageRead({ slug, type: 'note', frontmatter: {} })]),
    ).toEqual(expected);
  });

  it('a deleted anchor at the address keeps it occupied, so a new page does not replace it', () => {
    const expected: AnchorPlacement = { state: 'occupied', slug };

    expect(
      anchorPlacement('project', ALPHA_ID, [anchor(slug, ALPHA_ID, { deleted: true })]),
    ).toEqual(expected);
  });

  it('with several anchors, none is chosen', () => {
    const expected: AnchorPlacement = {
      state: 'integrity_error',
      slugs: ['projects/copy', slug].sort(),
    };

    expect(
      anchorPlacement('project', ALPHA_ID, [
        anchor(slug, ALPHA_ID),
        anchor('projects/copy', ALPHA_ID),
      ]),
    ).toEqual(expected);
  });
});
