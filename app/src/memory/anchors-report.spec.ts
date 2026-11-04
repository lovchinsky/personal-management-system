import { FakeGbrain } from '../../test/fixtures/fake-gbrain.fixture';
import { ALPHA_ID, BETA_ID, pageRead } from '../../test/fixtures/gbrain-pages.fixture';
import { anchorPage } from '../../test/gate/gbrain-fixture';
import { anchorsReport, problemsIn, renderReport } from './anchors-report';

async function planted(
  gbrain: FakeGbrain,
  notionId: string,
  slug?: string,
  paragraph = 'Нотатка.',
): Promise<string> {
  const page = anchorPage({
    type: 'project',
    notionId,
    title: 'Проєкт',
    paragraphs: [paragraph],
    slug,
  });

  await gbrain.putPage(page.slug, page.content);

  return page.slug;
}

describe('anchorsReport', () => {
  it('anchors that follow the convention are read and have no violations', async () => {
    const gbrain = new FakeGbrain();

    await planted(gbrain, ALPHA_ID);
    await planted(gbrain, BETA_ID);

    const report = await anchorsReport(gbrain);

    expect(report).toEqual({
      checked: 2,
      nonconforming: [],
      duplicated: [],
      drifted: [],
    });
    expect(problemsIn(report)).toBe(0);
    expect(renderReport(report)).toContain('no problems');
  });

  it('an empty GBrain yields nothing checked and no violations', async () => {
    const report = await anchorsReport(new FakeGbrain());

    expect(report.checked).toBe(0);
    expect(problemsIn(report)).toBe(0);
  });

  it('a page outside the convention is named with its violation codes', async () => {
    const gbrain = new FakeGbrain();

    await planted(gbrain, ALPHA_ID, 'projects/handmade');

    const report = await anchorsReport(gbrain);

    expect(report.nonconforming).toEqual([
      {
        slug: 'projects/handmade',
        violations: [
          {
            code: 'slug_mismatch',
            detail: `projects/handmade, expected projects/${ALPHA_ID.replaceAll('-', '')}`,
          },
        ],
      },
    ]);
    expect(renderReport(report)).toContain('does not follow the convention: projects/handmade');
  });

  it('two anchors of one object are named together, with both slugs', async () => {
    const gbrain = new FakeGbrain();
    const first = await planted(gbrain, ALPHA_ID);
    const copy = await planted(gbrain, ALPHA_ID, 'projects/copy');
    const report = await anchorsReport(gbrain);

    expect(report.duplicated).toEqual([{ notionId: ALPHA_ID, slugs: [copy, first].sort() }]);
    expect(renderReport(report)).toContain(`several anchors for ${ALPHA_ID}`);
  });

  it('events and facts that the page text no longer has are drift, and those written to the page are not', async () => {
    const gbrain = new FakeGbrain();
    const slug = await planted(gbrain, ALPHA_ID);

    await gbrain.addTimelineEntry({ slug, date: '2026-01-01', summary: 'Подія', source: 's' });
    await gbrain.remember({ fact: 'Факт', provenance: 'p', entity: slug, kind: 'fact' });

    expect((await anchorsReport(gbrain)).drifted).toEqual([]);

    // Different content without sections, because the server rewrites a page only when the content
    // differs.
    await planted(gbrain, ALPHA_ID, undefined, 'Перезаписано.');

    const report = await anchorsReport(gbrain);

    expect(report.drifted).toEqual([{ slug, timeline: 1, facts: 1 }]);
    expect(renderReport(report)).toContain(`${slug} (1 timeline entries, 1 facts)`);
  });

  it('a deleted page is not counted', async () => {
    const gbrain = new FakeGbrain();
    const slug = await planted(gbrain, ALPHA_ID);

    gbrain.pages.set(slug, { ...pageRead({ slug }), deleted: true });

    const report = await anchorsReport(gbrain);

    expect(report.checked).toBe(0);
  });
});
