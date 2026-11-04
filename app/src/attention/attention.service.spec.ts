import { Test } from '@nestjs/testing';
import { APIErrorCode } from '@notionhq/client';
import { CAPTURING, NOTICED } from '../../test/fixtures/actors';
import { notionAnswer } from '../../test/fixtures/notion-answer.fixture';
import { pageFor } from '../../test/fixtures/notion-page.fixture';
import { ApprovalsService } from '../approvals/approvals.service';
import { appConfig } from '../config/app.config';
import { ContinuationsService } from '../continuations/continuations.service';
import { SystemDiscussion } from '../generated/prisma/client';
import { WorkflowMode } from '../generated/prisma/enums';
import { CanonicalType } from '../notion/binding/binding.schema';
import { CommentTarget, NotionWriter, WrittenComment } from '../notion/client/notion.writer';
import { PageReader } from '../notion/client/page.reader';
import { SemanticAdapter } from '../notion/semantics/semantic.adapter';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { CHAT } from '../runs/actor';
import { AttentionService, quotedFrom } from './attention.service';
import { Comment, CommentRequest, MAX_COMMENT_CHARS } from './comment.schema';
import { SystemDiscussionRepository, SystemWrite } from './system-discussion.repository';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const NEW_THREAD = '3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e';
const BLOCK = '4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f';

/** A thread from the registry: the system commented in it during a run in `mode`. */
const written = (mode: WorkflowMode): SystemDiscussion => ({
  discussionId: THREAD,
  pageId: PAGE,
  mode,
  firstWrittenAt: new Date('2026-09-01T09:00:00.000Z'),
  lastWrittenAt: new Date('2026-09-20T09:00:00.000Z'),
  blockId: null,
  lastCommentId: null,
});

/**
 * The state of the world the attention capability talks to: Notion, the registry and the threads
 * that other capabilities have open.
 */
interface World {
  readonly service: AttentionService;
  /** What reached Notion and the registry. */
  readonly comments: [CommentTarget, string][];
  /** The label of each comment, in the same order; `undefined` means no label. */
  readonly labels: (string | undefined)[];
  readonly registered: SystemWrite[];
  /** The pages the attention capability read. */
  readonly read: string[];
}

interface Setting {
  readonly registry?: SystemDiscussion | null;
  readonly continued?: boolean;
  readonly proposed?: boolean;
  /** A thread on a block: Notion returns the block, not the page. */
  readonly onBlock?: boolean;
  /**
   * The type of the page's database per the binding; `null` means a database outside the binding.
   */
  readonly pageType?: CanonicalType | null;
  /** What Notion returns instead of the page when the page is read. */
  readonly pageFails?: Error;
}

async function worldOf(setting: Setting = {}): Promise<World> {
  const comments: [CommentTarget, string][] = [];
  const labels: (string | undefined)[] = [];
  const registered: SystemWrite[] = [];
  const writer: Pick<NotionWriter, 'comment'> = {
    comment: (target, text, extras) => {
      comments.push([target, text]);
      labels.push(extras?.label);

      const reply: WrittenComment = {
        commentId: 'comment-1',
        discussionId: 'discussionId' in target ? target.discussionId : NEW_THREAD,
        pageId: setting.onBlock ? null : PAGE,
        blockId: setting.onBlock ? BLOCK : null,
      };

      return Promise.resolve(reply);
    },
  };
  const discussions: Pick<SystemDiscussionRepository, 'wrote' | 'find' | 'pruneStale'> = {
    wrote: (write) => {
      registered.push(write);

      return Promise.resolve();
    },
    find: () => Promise.resolve(setting.registry ?? null),
    pruneStale: () => Promise.resolve(0),
  };
  const read: string[] = [];
  const pages: Pick<PageReader, 'page'> = {
    page: (pageId) => {
      read.push(pageId);

      return setting.pageFails
        ? Promise.reject(setting.pageFails)
        : Promise.resolve(pageFor('task'));
    },
  };
  const semantics: Pick<SemanticAdapter, 'typeOfDataSource'> = {
    typeOfDataSource: () => setting.pageType ?? undefined,
  };
  const continuations: Pick<ContinuationsService, 'hasOpenFor'> = {
    hasOpenFor: () => Promise.resolve(setting.continued ?? false),
  };
  const approvals: Pick<ApprovalsService, 'hasOpenFor'> = {
    hasOpenFor: () => Promise.resolve(setting.proposed ?? false),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AttentionService,
      { provide: appConfig.KEY, useValue: { ...appConfig(), language: 'uk' } },
      { provide: NotionWriter, useValue: writer },
      { provide: PageReader, useValue: pages },
      { provide: SemanticAdapter, useValue: semantics },
      { provide: SystemDiscussionRepository, useValue: discussions },
      { provide: ContinuationsService, useValue: continuations },
      { provide: ApprovalsService, useValue: approvals },
    ],
  }).compile();

  return { service: moduleRef.get(AttentionService), comments, labels, registered, read };
}

describe("the system's attention", () => {
  describe('comment check', () => {
    it('converts ids to one form and trims the text', async () => {
      const { service } = await worldOf();
      const expected: Comment = { pageId: PAGE, discussionId: THREAD, text: 'Нагадаю завтра' };

      expect(
        service.check({
          pageId: PAGE.replaceAll('-', '').toUpperCase(),
          discussionId: THREAD.replaceAll('-', ''),
          text: '  Нагадаю завтра \n',
        }),
      ).toEqual(expected);
    });

    const refused: [string, CommentRequest, string][] = [
      ['empty text', { pageId: PAGE, text: '  ' }, 'the text is empty'],
      [
        'text that is too long',
        { pageId: PAGE, text: 'x'.repeat(MAX_COMMENT_CHARS + 1) },
        'a comment is a message to a person',
      ],
      ['empty page id', { pageId: '', text: 'x' }, 'comment'],
    ];

    it.each(refused)('%s is refused with a reason', async (_, request, reason) => {
      const { service } = await worldOf();

      expect(() => service.check(request)).toThrow(InvalidRequestError);
      expect(() => service.check(request)).toThrow(reason);
    });
  });

  describe('comment', () => {
    it("without a thread, writes into the page's discussion and registers it", async () => {
      const { service, comments, registered } = await worldOf();
      const expected: SystemWrite[] = [
        {
          discussionId: NEW_THREAD,
          pageId: PAGE,
          blockId: null,
          commentId: 'comment-1',
          mode: 'event_evaluation',
        },
      ];

      await service.comment(NOTICED, { pageId: PAGE, text: 'Чекаю на відповідь банку' });

      expect(comments).toEqual([[{ pageId: PAGE }, 'Чекаю на відповідь банку']]);
      expect(registered).toEqual(expected);
    });

    it('with a thread, replies in that thread', async () => {
      const { service, comments } = await worldOf();

      await service.comment(NOTICED, { pageId: PAGE, discussionId: THREAD, text: 'Дякую' });

      expect(comments).toEqual([[{ discussionId: THREAD }, 'Дякую']]);
    });

    /**
     * For a thread on a block Notion does not return the page: the page from the request stays,
     * and the block is the anchor.
     */
    it('for a thread on a block, takes the page from the request and records the block as the anchor', async () => {
      const { service, registered } = await worldOf({ onBlock: true });

      await service.comment(NOTICED, { pageId: PAGE, discussionId: THREAD, text: 'Дякую' });

      expect(registered.map(({ pageId, blockId }) => [pageId, blockId])).toEqual([[PAGE, BLOCK]]);
    });
  });

  /**
   * A thread's first write sets its mode: a reply about an Inbox item counts as processing that
   * item, whoever opened the thread; every other thread continues in the mode of whoever opened
   * it, and a thread opened in the chat continues as a conversation.
   */
  describe('mode of the thread a write opens', () => {
    const REVIEWING = { ...NOTICED, mode: 'weekly_control_review' } satisfies typeof NOTICED;
    const cases: [
      string,
      CanonicalType | null,
      Parameters<AttentionService['comment']>[0],
      WorkflowMode,
    ][] = [
      ['review on an Inbox item', 'inbox_item', REVIEWING, 'dialogue'],
      ['evaluation on an Inbox item', 'inbox_item', NOTICED, 'dialogue'],
      ['review on a Task', 'task', REVIEWING, 'weekly_control_review'],
      ['evaluation on a Project', 'project', NOTICED, 'event_evaluation'],
      ['evaluation on a page outside the binding', null, NOTICED, 'event_evaluation'],
      ['chat on a Task', 'task', CHAT, 'dialogue'],
      ['processing an Inbox item', 'inbox_item', CAPTURING, 'dialogue'],
    ];

    it.each(cases)('%s → %s', async (_, pageType, actor, mode) => {
      const { service, registered } = await worldOf({ pageType });

      await service.comment(actor, { pageId: PAGE, text: 'x' });

      expect(registered.map((write) => write.mode)).toEqual([mode]);
    });

    it('a thread the registry already knows keeps its mode and the page is not read', async () => {
      const { service, registered, read } = await worldOf({
        registry: written('dialogue'),
        pageType: 'task',
      });

      await service.comment(REVIEWING, { pageId: PAGE, discussionId: THREAD, text: 'x' });

      expect(registered.map((write) => write.mode)).toEqual(['dialogue']);
      expect(read).toEqual([]);
    });

    it('a conversation does not read the page: its thread is a conversation on any page', async () => {
      const { service, read } = await worldOf({ pageType: 'task' });

      await service.comment(CHAT, { pageId: PAGE, text: 'x' });

      expect(read).toEqual([]);
    });

    it("the author's mode stays when Notion does not return the page", async () => {
      const { service, registered } = await worldOf({
        pageFails: notionAnswer(APIErrorCode.ServiceUnavailable, 503),
      });

      await service.comment(REVIEWING, { pageId: PAGE, text: 'x' });

      expect(registered.map((write) => write.mode)).toEqual(['weekly_control_review']);
    });

    it("a failure outside Notion is an error, not the author's mode", async () => {
      const { service, registered } = await worldOf({ pageFails: new TypeError('broken') });

      await expect(service.comment(REVIEWING, { pageId: PAGE, text: 'x' })).rejects.toThrow(
        'broken',
      );
      expect(registered).toEqual([]);
    });
  });

  /**
   * `INV-089`: the system manages a thread if it has commented in it or a continuation or
   * proposal is open on it.
   */
  describe('threads the system manages', () => {
    const cases: [string, Setting, 'dialogue' | 'event_evaluation' | null][] = [
      [
        'the system commented in a conversation: the reply continues the conversation',
        { registry: written('dialogue') },
        'dialogue',
      ],
      [
        'the system commented in an evaluation: the reply is evaluated',
        { registry: written('scheduled_recheck') },
        'event_evaluation',
      ],
      ['a thread with an open continuation is managed', { continued: true }, 'event_evaluation'],
      ['a thread with an open proposal is managed', { proposed: true }, 'event_evaluation'],
      ["none of these: the thread is not the system's", {}, null],
    ];

    it.each(cases)('%s', async (_, setting, expected) => {
      const { service } = await worldOf(setting);

      await expect(service.managed(THREAD.replaceAll('-', ''))).resolves.toBe(expected);
    });
  });

  /**
   * The person's words from a channel go into the thread the person replied to, as a bot comment
   * with a mark: the Skill reads that comment as the person's words, not as the system's voice.
   */
  describe("the person's words from a channel", () => {
    const TELEGRAM = 'Telegram';

    it('go into the same thread with the mark and do not change the registry', async () => {
      const { service, comments, registered } = await worldOf();

      await expect(service.quote(THREAD, TELEGRAM, 'відклади до понеділка')).resolves.toBe(PAGE);

      expect(comments).toEqual([
        [{ discussionId: THREAD }, `${quotedFrom(TELEGRAM)}\nвідклади до понеділка`],
      ]);
      expect(registered).toHaveLength(0);
    });

    /**
     * The mark in the text is for the model, which does not see the display name. A person who
     * opens the thread in Notion sees a label that says what this comment is (ADR 0043); a run's
     * comment has no label.
     */
    it("carry a kind label, and a run's comment does not", async () => {
      const { service, labels } = await worldOf();

      await service.quote(THREAD, TELEGRAM, 'так');
      await service.comment(NOTICED, { pageId: PAGE, text: 'Чекаю на відповідь банку' });

      expect(labels).toEqual(['Відповідь з Telegram', undefined]);
    });

    it('an id in another form refers to the same thread', async () => {
      const { service, comments } = await worldOf();

      await service.quote(THREAD.replaceAll('-', '').toUpperCase(), TELEGRAM, 'так');

      expect(comments.map(([target]) => target)).toEqual([{ discussionId: THREAD }]);
    });

    /**
     * What the person said must not be shortened silently: a long text goes in several
     * consecutive comments.
     */
    it('words that are too long for one comment are split into consecutive comments, losing nothing', async () => {
      const { service, comments } = await worldOf();
      const words = `${'а'.repeat(MAX_COMMENT_CHARS)}${'б'.repeat(10)}`;

      await service.quote(THREAD, TELEGRAM, words);

      const texts = comments.map(([, text]) => text);
      const carried = texts.map((text) => text.slice(quotedFrom(TELEGRAM).length + 1)).join('');

      expect(texts.length).toBeGreaterThan(1);
      expect(texts.every((text) => text.length <= MAX_COMMENT_CHARS)).toBe(true);
      expect(texts.every((text) => text.startsWith(quotedFrom(TELEGRAM)))).toBe(true);
      expect(carried).toBe(words);
    });

    /** A thread on a block: Notion returns the block, and the page comes from the registry. */
    it('for a thread on a block, takes the page from the registry', async () => {
      const { service } = await worldOf({ onBlock: true, registry: written('dialogue') });

      await expect(service.quote(THREAD, TELEGRAM, 'так')).resolves.toBe(PAGE);
    });

    it('a thread whose page neither Notion nor the registry knows is an error, not an invention', async () => {
      const { service } = await worldOf({ onBlock: true });

      await expect(service.quote(THREAD, TELEGRAM, 'так')).rejects.toThrow('names no page');
    });
  });
});
