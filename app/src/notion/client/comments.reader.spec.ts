import { Test } from '@nestjs/testing';
import {
  APIErrorCode,
  Client,
  type CommentObjectResponse,
  type ListCommentsResponse,
} from '@notionhq/client';
import { notionAnswer } from '../../../test/fixtures/notion-answer.fixture';
import { CommentsReader } from './comments.reader';

const PAGE = '5292b73a-cb69-7b28-d727-f00c42265be7';

function comment(id: string, discussionId: string): CommentObjectResponse {
  return {
    object: 'comment',
    id,
    parent: { type: 'page_id', page_id: PAGE },
    discussion_id: discussionId,
    created_time: '2026-10-15T10:00:00.000Z',
    last_edited_time: '2026-10-15T10:00:00.000Z',
    created_by: { object: 'user', id: 'bot-1' },
    rich_text: [],
    display_name: { type: 'integration', resolved_name: 'Personal Management System' },
  };
}

function listed(
  comments: readonly CommentObjectResponse[],
  next: string | null,
): ListCommentsResponse {
  return {
    type: 'comment',
    comment: {},
    object: 'list',
    next_cursor: next,
    has_more: next !== null,
    results: [...comments],
  };
}

describe('CommentsReader', () => {
  let reader: CommentsReader;
  let notion: Client;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CommentsReader, { provide: Client, useValue: new Client({ auth: 'test' }) }],
    }).compile();

    reader = moduleRef.get(CommentsReader);
    notion = moduleRef.get(Client);
  });

  it('threads of unresolved comments come from all result pages, in canonical form', async () => {
    const calls = jest
      .spyOn(notion.comments, 'list')
      .mockResolvedValueOnce(
        listed(
          [
            comment('c1', 'b9ecbFddE3F44f7b3e0ee4e1c815befA'),
            comment('c2', 'b9ecbfdd-e3f4-4f7b-3e0e-e4e1c815befa'),
          ],
          'cursor-2',
        ),
      )
      .mockResolvedValueOnce(listed([comment('c3', '3272dcac-bdeb-3e7d-52b6-43fc9cc99de3')], null));

    const open = await reader.openDiscussions(PAGE);

    expect([...open].sort()).toEqual([
      '3272dcac-bdeb-3e7d-52b6-43fc9cc99de3',
      'b9ecbfdd-e3f4-4f7b-3e0e-e4e1c815befa',
    ]);
    expect(calls).toHaveBeenLastCalledWith(
      expect.objectContaining({ block_id: PAGE, start_cursor: 'cursor-2' }),
    );
  });

  it('a comment that can be read from Notion exists, in a resolved thread too', async () => {
    jest.spyOn(notion.comments, 'retrieve').mockResolvedValue(comment('c1', 'd1'));

    await expect(reader.exists('c1')).resolves.toBe(true);
  });

  /**
   * Notion still returns a deleted comment by id, but with a marker: the thread is deleted, not
   * resolved.
   */
  it('a comment that Notion returns as deleted does not exist', async () => {
    // The SDK's response types do not yet name the field Notion uses to mark a deleted comment.
    const deleted = Object.assign(comment('c1', 'd1'), { original_content_deleted: true });

    jest.spyOn(notion.comments, 'retrieve').mockResolvedValue(deleted);

    await expect(reader.exists('c1')).resolves.toBe(false);
  });

  it('a comment that Notion cannot find does not exist', async () => {
    jest
      .spyOn(notion.comments, 'retrieve')
      .mockRejectedValue(notionAnswer(APIErrorCode.ObjectNotFound, 404));

    await expect(reader.exists('c1')).resolves.toBe(false);
  });

  it('a failure that says nothing about the comment propagates', async () => {
    const limited = notionAnswer(APIErrorCode.RateLimited, 429);

    jest.spyOn(notion.comments, 'retrieve').mockRejectedValue(limited);

    await expect(reader.exists('c1')).rejects.toBe(limited);
  });
});
