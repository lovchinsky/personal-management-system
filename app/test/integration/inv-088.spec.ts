import { CreateCommentParameters } from '@notionhq/client';
import { taskWithStatus } from '../fixtures/notion-page.fixture';
import { AppMcpHarness, buildAppMcpHarness, call, jsonOf, ToolArguments } from './app-mcp.harness';
import { truncateAll } from './database';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const TEXT = 'Задача чекає на відповідь постачальника вже тиждень';

/** The comment with which a run opens a thread on a page. */
const OPENING: ToolArguments['add_comment'] = { page_id: PAGE, text: TEXT };

/**
 * `INV-088` An App run does not write to Notion before a valid result: it makes system writes to
 * Notion only through the App, and they are applied together with the other App effects.
 *
 * The conclusion about validity is the dispatcher's (`INV-035`). This test shows that the write to
 * Notion depends on it: the run's writes are applied or discarded.
 */
describe('INV-088', () => {
  let harness: AppMcpHarness;

  beforeAll(async () => {
    harness = await buildAppMcpHarness(taskWithStatus('opt_next_action', 'Next Action'));
  });

  beforeEach(async () => {
    await truncateAll(harness.prisma);
    harness.notion.reset();
  });

  afterEach(async () => {
    await harness.disconnect();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('Notion hears nothing before the conclusion of the run', async () => {
    const { client } = await harness.connected();

    const staged = jsonOf(await call(client, 'add_comment', OPENING));

    expect(staged).toMatchObject({ staged: true });
    expect(harness.notion.created).toEqual([]);
    await expect(harness.prisma.systemDiscussion.count()).resolves.toBe(0);
  });

  /** A run that failed, was deferred or was aborted applies no writes. */
  it('a discarded run leaves no comment', async () => {
    const { session, client } = await harness.connected();

    await call(client, 'add_comment', OPENING);

    const report = await session.discard();

    expect(report.applied).toEqual([]);
    expect(harness.notion.created).toEqual([]);
    await expect(harness.prisma.systemDiscussion.count()).resolves.toBe(0);
  });

  /**
   * A failure that the model learned of only as temporary poisons the session: it composed the
   * rest of the plan blindly, so the comment is not applied either.
   */
  it('a poisoned session writes no comment', async () => {
    const { session, client } = await harness.connected();

    await call(client, 'add_comment', OPENING);

    const live = harness.sessions.resolve(session.bearer);
    if (!live) {
      throw new Error('an open session does not resolve');
    }

    live.writes.poison('get_delivery_state: connection terminated');

    const report = await session.commit();

    expect(report.failure).toContain('poisoned');
    expect(harness.notion.created).toEqual([]);
  });

  it("a valid conclusion writes exactly one comment, in the system's voice", async () => {
    const { session, client } = await harness.connected();

    await call(client, 'add_comment', OPENING);

    const report = await session.commit();
    const expected: CreateCommentParameters[] = [
      { parent: { page_id: PAGE }, rich_text: [{ type: 'text', text: { content: TEXT } }] },
    ];

    expect(report.failure).toBeUndefined();
    expect(report.applied.map((effect) => effect.kind)).toEqual(['comment']);
    expect(harness.notion.created).toEqual(expected);
    await expect(harness.prisma.systemDiscussion.count()).resolves.toBe(1);
  });
});
