import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fixturePages,
  fixtureProblems,
  fixtureThreads,
  readRegistry,
  readyAt,
  type FixtureRegistry,
  type ObservedFixtures,
  type ObservedPage,
} from './m8-fixtures';

const PLAIN = '4e1c4232-8438-86af-937d-7028fc5849fa';
const ASKED = 'ab6fe242-eeb8-6b2d-cfb8-ade06fefc29f';
const THREAD = '746380a3-d69f-4995-be68-9621bc25e0f7';
const COMMENT = 'a117d775-c400-c831-491f-3bd363547dde';
const CAPTURED = '2026-10-21T00:53:00.000Z';
const STALE = new Date('2026-10-24T01:00:00.000Z');

const REGISTRY: FixtureRegistry = {
  inbox: {
    plain: { page: PLAIN, captured_at: CAPTURED },
    asked: {
      page: ASKED,
      captured_at: CAPTURED,
      thread: {
        discussion: THREAD,
        comment: COMMENT,
        mode: 'dialogue',
        first_written_at: '2026-10-21T00:53:46.891Z',
        last_written_at: '2026-10-21T00:53:46.891Z',
      },
    },
  },
};

const PLAIN_PAGE: ObservedPage = {
  inTrash: false,
  inInbox: true,
  capturedAt: CAPTURED,
  comments: [],
};
const ASKED_PAGE: ObservedPage = { ...PLAIN_PAGE, comments: [COMMENT] };
const ASKED_THREAD: ObservedFixtures['threads'][number] = {
  discussionId: THREAD,
  pageId: ASKED,
  mode: 'dialogue',
  lastCommentId: COMMENT,
};

/**
 * Seeded items in the declared state: pages in the Inbox, the only comment is the question, the
 * thread is in the registry.
 */
const DECLARED: ObservedFixtures = {
  pages: { plain: PLAIN_PAGE, asked: ASKED_PAGE },
  threads: [ASKED_THREAD],
  rows: [],
};

describe('seeded items', () => {
  it('the registry is read from a file; with no file nothing is seeded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
    const file = join(dir, 'fixtures.yaml');

    expect(readRegistry(file)).toEqual({ inbox: {} });

    writeFileSync(file, `inbox:\n  plain:\n    page: ${PLAIN}\n    captured_at: ${CAPTURED}\n`);

    expect(readRegistry(file)).toEqual({
      inbox: { plain: { page: PLAIN, captured_at: CAPTURED } },
    });
  });

  it('pages and threads of the seeded items are in canonical spelling', () => {
    expect(fixturePages(REGISTRY)).toEqual([PLAIN, ASKED]);
    expect(fixtureThreads(REGISTRY)).toEqual([THREAD]);
  });

  it('seeded items become stale three days after the latest capture; an incomplete set never does', () => {
    expect(readyAt(REGISTRY)?.toISOString()).toBe('2026-10-24T00:53:00.000Z');
    expect(readyAt({ inbox: { plain: REGISTRY.inbox.plain } })).toBeNull();
  });

  it('items in the declared state and stale raise no problems', () => {
    expect(fixtureProblems(REGISTRY, DECLARED, STALE)).toEqual([]);
  });

  it('items not yet stale yield a reason with the time', () => {
    expect(fixtureProblems(REGISTRY, DECLARED, new Date('2026-10-23T00:00:00.000Z'))).toEqual([
      'the plain Inbox item is stale only from 2026-10-24T00:53:00.000Z',
      'the asked Inbox item is stale only from 2026-10-24T00:53:00.000Z',
    ]);
  });

  it.each([
    [
      'that is not seeded',
      { inbox: { plain: REGISTRY.inbox.plain } },
      DECLARED,
      'the asked Inbox item is not planted: run bin/gate m8 --seed',
    ],
    [
      'in the trash',
      REGISTRY,
      { ...DECLARED, pages: { ...DECLARED.pages, plain: { ...PLAIN_PAGE, inTrash: true } } },
      `the plain Inbox item ${PLAIN} is gone from the Inbox: run bin/gate m8 --seed`,
    ],
    [
      'with a capture time that cannot be read',
      REGISTRY,
      { ...DECLARED, pages: { ...DECLARED.pages, plain: { ...PLAIN_PAGE, capturedAt: null } } },
      'the capture moment of the plain Inbox item does not read',
    ],
    [
      'captured at a time other than declared',
      REGISTRY,
      {
        ...DECLARED,
        pages: {
          ...DECLARED.pages,
          plain: { ...PLAIN_PAGE, capturedAt: '2026-10-22T10:00:00.000Z' },
        },
      },
      `the plain Inbox item is captured at 2026-10-22T10:00:00.000Z, not at the declared ${CAPTURED}: run bin/gate m8 --seed`,
    ],
    [
      'with a foreign comment',
      REGISTRY,
      { ...DECLARED, pages: { ...DECLARED.pages, plain: { ...PLAIN_PAGE, comments: ['c-1'] } } },
      'the plain Inbox item carries undeclared comments c-1',
    ],
    [
      'without its own question',
      REGISTRY,
      { ...DECLARED, pages: { ...DECLARED.pages, asked: { ...ASKED_PAGE, comments: [] } } },
      `the asked Inbox item lost its comment ${COMMENT}`,
    ],
    [
      'with a thread the registry did not declare',
      REGISTRY,
      {
        ...DECLARED,
        threads: [
          ...DECLARED.threads,
          { discussionId: 'thread-x', pageId: PLAIN, mode: 'dialogue', lastCommentId: 'c-2' },
        ],
      },
      'threads nobody declared lie on the planted Inbox items: thread-x',
    ],
    [
      'with a thread that forgot its comment',
      REGISTRY,
      { ...DECLARED, threads: [{ ...ASKED_THREAD, lastCommentId: 'c-3' }] },
      'the thread of the asked Inbox item is not registered as declared',
    ],
    [
      'with a queue row about it',
      REGISTRY,
      { ...DECLARED, rows: ['the follow-up check-1'] },
      'the follow-up check-1 refers to a planted Inbox item',
    ],
  ])('an item %s raises a problem with advice', (_, registry, observed, problem) => {
    expect(fixtureProblems(registry, observed, STALE)).toContain(problem);
  });
});
