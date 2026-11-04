import { anchorSlug } from '../../src/knowledge/anchor-page';
import {
  anchorPlacement,
  CANDIDATE_EVIDENCE,
  candidateSlugs,
  IDENTITY_STATES,
  resolveAnchor,
  slugsToRead,
  type AnchorIdentity,
  type AnchorPlacement,
} from '../../src/knowledge/exact-identity';
import { type PageRead, type SearchHit } from '../../src/knowledge/gbrain-pages';
import { ALPHA_ID, BETA_ID, pageRead } from '../fixtures/gbrain-pages.fixture';
import { canonical } from './contracts';

/**
 * `INV-098` An anchor's exact identity has three states. The candidates are pages of the anchor
 * types that the search by id in the hyphenated form marked as an exact match; a candidate becomes
 * the anchor only when `frontmatter.notion_id` matches the id. Two pages whose `notion_id` matches
 * the id yield `integrity_error`: neither is chosen. A memory entry lands on the single anchor. It
 * lands on a new anchor only at a free conventional address, and it is refused when the address is
 * occupied or there are several anchors. Similarity does not establish identity.
 */
describe('INV-098', () => {
  it('the states and the exact-match marker in the code match the contract', () => {
    const contract = canonical.gbrainExactIdentity();

    expect([...IDENTITY_STATES]).toEqual(contract.states);
    expect(CANDIDATE_EVIDENCE).toBe(contract.candidate_evidence);
  });

  const exact = (slug: string, notionId: string, overrides: Partial<PageRead> = {}): PageRead =>
    pageRead({ slug, frontmatter: { notion_id: notionId }, ...overrides });

  it('an empty search response does not prove absence: the page at the conventional address is a candidate', () => {
    const address = anchorSlug('project', ALPHA_ID);

    expect(slugsToRead([], 'project', ALPHA_ID)).toEqual([address]);
    expect(resolveAnchor(ALPHA_ID, [exact(address, ALPHA_ID)])).toEqual({
      state: 'exact',
      slug: address,
    });
    expect(resolveAnchor(ALPHA_ID, [])).toEqual({ state: 'absent' });
  });

  it('a page similar in content does not replace an anchor', () => {
    const similar: SearchHit = {
      slug: 'projects/launch-beta',
      title: 'Launch Beta',
      type: 'project',
      evidence: 'weak_semantic',
    };

    expect(candidateSlugs([similar])).toEqual([]);
    expect(resolveAnchor(ALPHA_ID, [])).toEqual<AnchorIdentity>({ state: 'absent' });
  });

  it('only equality of notion_id makes a page an anchor, not its title or alias', () => {
    const lookalike: PageRead = exact('projects/launch-alpha', BETA_ID, {
      title: 'Launch Alpha',
      frontmatter: { notion_id: BETA_ID, aliases: ['Alpha launch'] },
    });

    expect(resolveAnchor(ALPHA_ID, [lookalike])).toEqual<AnchorIdentity>({ state: 'absent' });
  });

  it('no state stays silent about two pages: they are not chosen by freshness or slug', () => {
    const conforming: PageRead = exact(anchorSlug('project', ALPHA_ID), ALPHA_ID);
    const handMade: PageRead = exact('projects/alpha-duplicate', ALPHA_ID);

    for (const pages of [
      [conforming, handMade],
      [handMade, conforming],
    ]) {
      const result: AnchorIdentity = resolveAnchor(ALPHA_ID, pages);

      expect(result.state).toBe('integrity_error');
      expect('slug' in result).toBe(false);
    }
  });

  describe('where a memory entry lands', () => {
    const address = anchorSlug('project', ALPHA_ID);

    it.each<[string, readonly PageRead[], AnchorPlacement['state']]>([
      ['on the single anchor', [exact(address, ALPHA_ID)], 'exact'],
      ['in a new anchor when the address is free', [], 'create'],
      ['nowhere when a different page is at the address', [exact(address, BETA_ID)], 'occupied'],
      [
        'nowhere when a deleted page is at the address',
        [exact(address, ALPHA_ID, { deleted: true })],
        'occupied',
      ],
      [
        'nowhere when there are several anchors',
        [exact(address, ALPHA_ID), exact('projects/copy', ALPHA_ID)],
        'integrity_error',
      ],
    ])('%s', (_name, candidates, state) => {
      expect(anchorPlacement('project', ALPHA_ID, candidates).state).toBe(state);
    });

    it("a new anchor is created only at the object's conventional address", () => {
      expect(anchorPlacement('project', ALPHA_ID, [])).toEqual({ state: 'create', slug: address });
    });
  });
});
