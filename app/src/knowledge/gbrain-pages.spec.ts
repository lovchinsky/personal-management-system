import {
  GbrainShapeError,
  parseFacts,
  parsePage,
  parsePageList,
  parseRemembered,
  parseSearchHits,
  parseTimeline,
  type PageRead,
  type Remembered,
  type SearchHit,
} from './gbrain-pages';

/**
 * Responses captured from GBrain 0.48.5.0 (`docs/5-plan.md` § “Spikes”), trimmed to the needed
 * fields and unused ones.
 */
describe('parseSearchHits', () => {
  it('reads the slug, type, title and match mark; ignores the rest of the response', () => {
    const text = JSON.stringify([
      {
        slug: 'projects/launch-beta',
        page_id: 3,
        title: 'Launch Beta',
        type: 'project',
        chunk_text: '# Launch Beta',
        score: 0.99,
        evidence: 'keyword_exact',
        create_safety: 'probable',
      },
    ]);

    expect(parseSearchHits(text)).toEqual<SearchHit[]>([
      {
        slug: 'projects/launch-beta',
        title: 'Launch Beta',
        type: 'project',
        evidence: 'keyword_exact',
      },
    ]);
  });

  it('a response without a match mark yields `null` evidence, not a guess', () => {
    const text = JSON.stringify([{ slug: 'a/b', title: 'B', type: 'note' }]);

    expect(parseSearchHits(text)[0]?.evidence).toBeNull();
  });

  /**
   * An empty search is the response `[]` and a status line; “nothing found” is the state
   * `absent`, not a failure.
   */
  it('an empty search: an array and a status line after it mean nothing found', () => {
    const text =
      '[]\n0 results. retrieved 0 before trimming. no retrieval degradation — this is a clean miss.';

    expect(parseSearchHits(text)).toEqual([]);
  });

  it('a status line after a non-empty response does not interfere either', () => {
    const text = `${JSON.stringify([{ slug: 'a/b', title: 'B', type: 'note' }], null, 2)}\n1 results.`;

    expect(parseSearchHits(text).map((hit) => hit.slug)).toEqual(['a/b']);
  });
});

describe('parsePage', () => {
  it('extracts compiled truth, timeline, frontmatter and the deletion flag', () => {
    const text = JSON.stringify({
      slug: 'projects/gamma',
      type: 'project',
      title: 'Gamma',
      compiled_truth: '# Gamma',
      timeline: '## Timeline',
      frontmatter: { notion_id: 'x' },
      deleted_at: null,
      tags: [],
    });

    expect(parsePage(text)).toEqual<PageRead>({
      slug: 'projects/gamma',
      type: 'project',
      title: 'Gamma',
      compiledTruth: '# Gamma',
      timeline: '## Timeline',
      frontmatter: { notion_id: 'x' },
      deleted: false,
    });
    expect(
      parsePage(text.replace('"deleted_at":null', '"deleted_at":"2026-10-13T10:00:00Z"')).deleted,
    ).toBe(true);
  });
});

describe('parseTimeline', () => {
  it('an event without a source and detail is read with empty fields', () => {
    const text = JSON.stringify([{ date: '2026-10-13', summary: 'x', source: null }]);

    expect(parseTimeline(text)).toEqual([
      { date: '2026-10-13', source: '', summary: 'x', detail: '' },
    ]);
  });

  it('reduces a date-time to a day', () => {
    const text = JSON.stringify([
      { id: 1, date: '2026-10-13T00:00:00.000Z', source: 's', summary: 'x', detail: '' },
    ]);

    expect(parseTimeline(text)).toEqual([
      { date: '2026-10-13', source: 's', summary: 'x', detail: '' },
    ]);
  });
});

describe('parseFacts', () => {
  it('a fact without a source is read with an empty source and does not break the response', () => {
    const text = JSON.stringify({
      facts: [{ fact: 'a', kind: 'fact', entity_slug: 'projects/gamma', provenance: null }],
    });

    expect(parseFacts(text).map((fact) => fact.provenance)).toEqual(['']);
  });

  it('reads facts about a page and a fact with no page', () => {
    const text = JSON.stringify({
      facts: [
        { fact: 'a', kind: 'fact', entity_slug: 'projects/gamma', provenance: 'p' },
        { fact: 'b', kind: 'preference', entity_slug: null, provenance: 'q' },
      ],
      total: 2,
    });

    expect(parseFacts(text).map((fact) => fact.entitySlug)).toEqual(['projects/gamma', null]);
  });
});

describe('parsePageList', () => {
  it('reads the page list without content', () => {
    expect(
      parsePageList(
        JSON.stringify([{ slug: 'a/b', type: 'project', title: 'B', updated_at: 'x' }]),
      ),
    ).toEqual([{ slug: 'a/b', type: 'project', title: 'B' }]);
  });
});

describe('a response of another shape is malformed, not empty', () => {
  it.each([
    ['not JSON', () => parseSearchHits('not json')],
    ['a page without compiled_truth', () => parsePage('{"slug":"a","type":"x","title":"t"}')],
    ['a search that is not a list', () => parseSearchHits('{"error":"invalid_params"}')],
  ])('%s', (_name, parse) => {
    expect(parse).toThrow(GbrainShapeError);
  });

  it('names the tool whose response could not be parsed', () => {
    expect(() => parseTimeline('[{"date":1}]')).toThrow(/gbrain get_timeline/);
  });
});

describe('parseRemembered', () => {
  it('reads the fact id and what happened to it; ignores the rest of the response', () => {
    const text = JSON.stringify({
      id: '42',
      status: 'inserted',
      status_text: 'remembered as fact #42',
      entity_slug: 'projects/aaaa',
      valid_until: null,
      protocol_version: 1,
    });
    const expected: Remembered = { id: '42', status: 'inserted' };

    expect(parseRemembered(text)).toEqual(expected);
  });

  it('a response without an id has the wrong shape', () => {
    expect(() => parseRemembered(JSON.stringify({ status: 'inserted' }))).toThrow(GbrainShapeError);
  });
});
