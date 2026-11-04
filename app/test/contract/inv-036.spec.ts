import type { EvaluationResult } from '../../src/claude/result/evaluation-result';
import { unreadEvidence } from '../../src/claude/result/evidence';
import { McpServerName } from '../../src/generated/prisma/enums';
import { aResult } from '../fixtures/claude-stream.fixture';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';

/**
 * `INV-036` Every `evidence` ref matches an object read by a tool call in the same run. The
 * validator is checked against trace fixtures. Whether real runs satisfy it is an evals metric.
 */
describe('INV-036', () => {
  const reads = (entries: [McpServerName, string[]][]): Map<McpServerName, string[]> =>
    new Map(entries);

  it('evidence read by the same server counts as read', () => {
    expect(unreadEvidence(aResult(PAGE), reads([['notion', [`{"id":"${PAGE}"}`]]]))).toEqual([]);
  });

  /** The model takes the id from a URL too, where there are no hyphens. */
  it('Notion ids are compared in canonical form', () => {
    const undashed = PAGE.replaceAll('-', '').toUpperCase();

    expect(unreadEvidence(aResult(undashed), reads([['notion', [`page ${PAGE}`]]]))).toEqual([]);
  });

  /**
   * A query response names the database by its id, while the model quotes the address through
   * which it requested the database.
   */
  it('a Notion link with one id is matched by that id: a `collection://` database and a page URL', () => {
    const replies = reads([['notion', [`{"results":[],"data_source_ids":["${PAGE}"]}`]]]);

    expect(unreadEvidence(aResult(`collection://${PAGE}`), replies)).toEqual([]);
    expect(
      unreadEvidence(aResult(`https://app.notion.com/p/${PAGE.replaceAll('-', '')}`), replies),
    ).toEqual([]);
  });

  it('a link with several ids or outside Notion is compared as a string', () => {
    const other = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
    const twoIds = `https://www.notion.so/${PAGE.replaceAll('-', '')}?p=${other.replaceAll('-', '')}`;
    const slug = `areas-of-focus/${PAGE.replaceAll('-', '')}`;

    expect(unreadEvidence(aResult(twoIds), reads([['notion', [PAGE, other]]]))).toHaveLength(1);
    const fromGbrain: EvaluationResult = {
      ...aResult(),
      detections: aResult().detections.map((detection) => ({
        ...detection,
        evidence: [{ server: 'gbrain', ref: slug }],
      })),
    };

    expect(unreadEvidence(fromGbrain, reads([['gbrain', [PAGE]]]))).toHaveLength(1);
  });

  it('evidence that no call read is unread', () => {
    expect(unreadEvidence(aResult(PAGE), reads([]))).toEqual([{ server: 'notion', ref: PAGE }]);
  });

  it('what another server read does not count', () => {
    expect(unreadEvidence(aResult(PAGE), reads([['gbrain', [PAGE]]]))).toHaveLength(1);
  });
});
