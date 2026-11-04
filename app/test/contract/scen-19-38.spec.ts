import { anchorSlug } from '../../src/knowledge/anchor-page';
import {
  candidateSlugs,
  resolveAnchor,
  type AnchorIdentity,
} from '../../src/knowledge/exact-identity';
import { parsePage, parseSearchHits } from '../../src/knowledge/gbrain-pages';
import { ALPHA_ID, BETA_ID } from '../fixtures/gbrain-pages.fixture';

/**
 * `SCEN-19-38` Two exact GBrain anchors yield an integrity warning without an automatic choice.
 *
 * The input consists of GBrain 0.48.5.0's answers to a search by id, as recorded (cut down to the
 * needed fields): two project anchors, a lesson page that merely mentions the id, and a page that
 * the search presented as a weak semantic match. `resolveAnchor` is `INV-098` applied to this
 * input.
 */
describe('SCEN-19-38', () => {
  const hit = (slug: string, type: string, evidence: string): Record<string, string> => ({
    slug,
    title: slug,
    type,
    evidence,
  });

  const searchAnswer: string = JSON.stringify([
    hit(anchorSlug('project', ALPHA_ID), 'project', 'keyword_exact'),
    hit('projects/alpha-duplicate', 'project', 'keyword_exact'),
    hit('lessons/vendor-escalation', 'note', 'keyword_exact'),
    hit('projects/launch-beta', 'project', 'weak_semantic'),
  ]);

  const page = (slug: string, type: string, notionId: string | null): string =>
    JSON.stringify({
      slug,
      type,
      title: slug,
      compiled_truth: `# ${slug}\n\nNotion: ${ALPHA_ID}`,
      timeline: '',
      frontmatter: notionId === null ? {} : { notion_id: notionId },
      deleted_at: null,
    });

  it('candidates are only anchor types marked as an exact match: a mention and a similar page are filtered out', () => {
    expect(candidateSlugs(parseSearchHits(searchAnswer))).toEqual([
      anchorSlug('project', ALPHA_ID),
      'projects/alpha-duplicate',
    ]);
  });

  it('both candidates have the notion_id of this project: the result is `integrity_error`, with no choice', () => {
    const pages = [
      parsePage(page(anchorSlug('project', ALPHA_ID), 'project', ALPHA_ID)),
      parsePage(page('projects/alpha-duplicate', 'project', ALPHA_ID)),
    ];
    const result: AnchorIdentity = resolveAnchor(ALPHA_ID, pages);

    expect(result).toEqual({
      state: 'integrity_error',
      slugs: [anchorSlug('project', ALPHA_ID), 'projects/alpha-duplicate'],
    });
  });

  it('a candidate with a different notion_id does not create a duplicate: there is one anchor', () => {
    const pages = [
      parsePage(page(anchorSlug('project', ALPHA_ID), 'project', ALPHA_ID)),
      parsePage(page('projects/alpha-duplicate', 'project', BETA_ID)),
    ];

    expect(resolveAnchor(ALPHA_ID, pages)).toEqual({
      state: 'exact',
      slug: anchorSlug('project', ALPHA_ID),
    });
  });
});
