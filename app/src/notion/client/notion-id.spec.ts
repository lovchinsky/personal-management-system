import { canonicalDiscussionId, canonicalNotionId } from './notion-id';

const CANONICAL = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';

describe('a Notion id in one form', () => {
  it.each([
    ['with hyphens', CANONICAL],
    ['without hyphens, as in a URL', '1f2e3d4c5b6a49788a9b0c1d2e3f4a5b'],
    ['in uppercase', '1F2E3D4C-5B6A-4978-8A9B-0C1D2E3F4A5B'],
    // One rule recognizes the form: a partly hyphenated id is the same id.
    ['with some of the hyphens', '1f2e3d4c5b6a-4978-8a9b-0c1d2e3f4a5b'],
  ])('%s → canonical form', (_form, id) => {
    expect(canonicalNotionId(id)).toBe(CANONICAL);
  });

  /** The conversion is idempotent: a stored id is read by the same function. */
  it('the canonical form stays the same', () => {
    expect(canonicalNotionId(canonicalNotionId(CANONICAL))).toBe(CANONICAL);
  });

  it('a string that is not a UUID is left untouched', () => {
    expect(canonicalNotionId('page-1')).toBe('page-1');
  });
});

describe('a Notion thread id in one form', () => {
  const PAGE = '860a8620-9611-7dbd-6c10-fa3cabd4f1de';

  /**
   * The Notion MCP shows a thread to the model by its address, while REST and the thread registry
   * know only ids.
   */
  it('a Notion MCP thread address yields the thread id', () => {
    expect(canonicalDiscussionId(`discussion://${PAGE}/${PAGE}/${CANONICAL}`)).toBe(CANONICAL);
    expect(canonicalDiscussionId(`discussion://${PAGE}/1F2E3D4C5B6A49788A9B0C1D2E3F4A5B`)).toBe(
      CANONICAL,
    );
  });

  it('a thread id in any spelling comes out canonical, and a non-id stays as it is', () => {
    expect(canonicalDiscussionId('1f2e3d4c5b6a49788a9b0c1d2e3f4a5b')).toBe(CANONICAL);
    expect(canonicalDiscussionId('thread-1')).toBe('thread-1');
  });
});
