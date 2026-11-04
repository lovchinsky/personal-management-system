import { FakeGbrain } from '../../test/fixtures/fake-gbrain.fixture';
import { ALPHA_ID, BETA_ID } from '../../test/fixtures/gbrain-pages.fixture';
import { anchorPage, plainPage } from '../../test/gate/gbrain-fixture';
import type { SearchHit } from '../knowledge/gbrain-pages';
import { identityOf } from './gbrain-identity';

function anchorOf(notionId: string, slug?: string): ReturnType<typeof anchorPage> {
  const page = anchorPage({
    type: 'project',
    notionId,
    title: 'Проєкт',
    paragraphs: ['Нотатка.'],
  });

  return slug === undefined ? page : { ...page, slug };
}

describe('identityOf', () => {
  it('an object without an anchor has state `absent`', async () => {
    const gbrain = new FakeGbrain();

    await expect(identityOf(gbrain, 'project', ALPHA_ID)).resolves.toEqual({ state: 'absent' });
  });

  it('one anchor yields state `exact` with the page slug', async () => {
    const gbrain = new FakeGbrain();
    const page = anchorOf(ALPHA_ID);

    await gbrain.putPage(page.slug, page.content);

    await expect(identityOf(gbrain, 'project', ALPHA_ID)).resolves.toEqual({
      state: 'exact',
      slug: page.slug,
    });
  });

  it('two anchors with the same id yield `integrity_error` with both slugs, and none is chosen', async () => {
    const gbrain = new FakeGbrain();
    const first = anchorOf(ALPHA_ID);
    const copy = anchorOf(ALPHA_ID, 'projects/copy');

    await gbrain.putPage(first.slug, first.content);
    await gbrain.putPage(copy.slug, copy.content);

    await expect(identityOf(gbrain, 'project', ALPHA_ID)).resolves.toEqual({
      state: 'integrity_error',
      slugs: [copy.slug, first.slug].sort(),
    });
  });

  /**
   * Search lags behind writes: a page with a just-added event is not found by id, but is read by
   * its address.
   */
  it('the anchor exists when search misses the page but it sits at the conventional address', async () => {
    class Lagging extends FakeGbrain {
      override searchHits(): Promise<SearchHit[]> {
        return Promise.resolve([]);
      }
    }

    const gbrain = new Lagging();
    const page = anchorOf(ALPHA_ID);

    await gbrain.putPage(page.slug, page.content);

    await expect(identityOf(gbrain, 'project', ALPHA_ID)).resolves.toEqual({
      state: 'exact',
      slug: page.slug,
    });
  });

  it('neither a page that only mentions the id nor the anchor of another object is the anchor', async () => {
    const gbrain = new FakeGbrain();
    const mention = plainPage({
      slug: 'notes/meeting',
      type: 'note',
      title: 'Нотатка',
      paragraphs: ['Текст.'],
      mentions: ALPHA_ID,
    });
    const other = anchorOf(BETA_ID);

    await gbrain.putPage(mention.slug, mention.content);
    await gbrain.putPage(other.slug, other.content);

    await expect(identityOf(gbrain, 'project', ALPHA_ID)).resolves.toEqual({ state: 'absent' });
  });

  it('an id spelled without hyphens yields the same answer', async () => {
    const gbrain = new FakeGbrain();
    const page = anchorOf(ALPHA_ID);

    await gbrain.putPage(page.slug, page.content);

    await expect(identityOf(gbrain, 'project', ALPHA_ID.replaceAll('-', ''))).resolves.toEqual({
      state: 'exact',
      slug: page.slug,
    });
  });
});
