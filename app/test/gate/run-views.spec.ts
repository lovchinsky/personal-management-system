import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Module, Optional } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RUN_TAP, type AttemptView, type RunTap } from '../../src/claude/runner/run-tap';
import { RunViews, RunViewsModule } from './run-views';

const VIEW: AttemptView = {
  skillReads: ['skills/run/SKILL.md'],
  rejections: ['Output does not match required schema: /type'],
  gbrainCalls: [{ tool: 'get_page', ok: true, input: { slug: 'projects/a' } }],
  transcript: [],
};

/** The attempt stream: the model's text and the response to a tool call. */
const STREAM: readonly unknown[] = [
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the thread' }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: 'a comment' }] } },
];

@Injectable()
class Consumer {
  constructor(@Optional() @Inject(RUN_TAP) readonly tap?: RunTap) {}
}

/** A runner module: not global, unaware of the collector and imported into the root before it. */
@Module({ providers: [Consumer], exports: [Consumer] })
class FeatureModule {}

/** Creates the gate collector with or without a transcripts directory. */
const viewsWith = (transcriptsDir?: string): RunViews =>
  new RunViews({ appMcpUrl: undefined, notionQueryAllowance: 10, transcriptsDir });

describe('RunViews', () => {
  it('writes the attempt stream to the run file, a line per message, and does not keep it in memory', () => {
    const transcripts = mkdtempSync(join(tmpdir(), 'transcripts-'));
    const views = viewsWith(transcripts);

    views.attempted('run-1', { ...VIEW, transcript: STREAM });

    expect(
      readFileSync(join(transcripts, 'run-1.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line)),
    ).toEqual(STREAM);
    expect(views.of('run-1')).toEqual(VIEW);
  });

  it('without a directory the stream is not written, and the attempt view is kept as usual', () => {
    const views = viewsWith();

    views.attempted('run-1', { ...VIEW, transcript: STREAM });

    expect(views.of('run-1')).toEqual(VIEW);
  });

  it('returns what the runner reported about a run', () => {
    const views = viewsWith();

    views.attempted('run-1', VIEW);

    expect(views.of('run-1')).toEqual(VIEW);
  });

  it('a run nothing was reported about is empty, not an error', () => {
    expect(viewsWith().of('run-1')).toEqual({
      skillReads: [],
      rejections: [],
      gbrainCalls: [],
      transcript: [],
    });
  });

  it('a second attempt of the same run replaces the first', () => {
    const views = viewsWith();

    views.attempted('run-1', { skillReads: [], rejections: [], gbrainCalls: [], transcript: [] });
    views.attempted('run-1', VIEW);

    expect(views.of('run-1')).toEqual(VIEW);
  });

  it('reading a record does not remove it, so the evidence can be collected twice', () => {
    const views = viewsWith();

    views.attempted('run-1', VIEW);
    views.of('run-1');

    expect(views.of('run-1')).toEqual(VIEW);
  });

  it('runs are not mixed up', () => {
    const views = viewsWith();

    views.attempted('run-1', VIEW);

    expect(views.of('run-2')).toEqual({
      skillReads: [],
      rejections: [],
      gbrainCalls: [],
      transcript: [],
    });
  });

  it('derives the Notion reads from the attempt stream, and an unknown run has no reads', () => {
    const views = viewsWith();

    views.attempted('run-1', {
      ...VIEW,
      transcript: [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'use-1',
                name: 'mcp__notion__notion-fetch',
                input: { id: 'f6ae5ebc-ec61-f49f-e0ac-a9cc1cc82284' },
              },
            ],
          },
        },
        {
          type: 'user',
          timestamp: '2026-10-21T08:00:00.000Z',
          message: { content: [{ type: 'tool_result', tool_use_id: 'use-1', content: '{}' }] },
        },
      ],
    });

    expect(views.readsOf('run-1')).toEqual([
      {
        tool: 'notion-fetch',
        mode: null,
        at: '2026-10-21T08:00:00.000Z',
        ok: true,
        refused: false,
        metered: false,
        pages: ['f6ae5ebc-ec61-f49f-e0ac-a9cc1cc82284'],
        dataSources: [],
      },
    ]);
    expect(views.readsOf('run-2')).toEqual([]);
  });

  /**
   * The subscription to the runner is made through the `RUN_TAP` token: the collector and the
   * token are one instance.
   */
  it('the module subscribes the collector under the runner token', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [RunViewsModule] }).compile();

    expect(moduleRef.get<RunTap>(RUN_TAP)).toBe(moduleRef.get(RunViews));
  });

  /**
   * The module is global, which provides the runner with the token without changing its own module.
   */
  it('a runner from another module sees the collector, and without the module sees nothing', async () => {
    const withViews = await Test.createTestingModule({
      imports: [FeatureModule, RunViewsModule],
    }).compile();
    const without = await Test.createTestingModule({ imports: [FeatureModule] }).compile();

    expect(withViews.get(Consumer).tap).toBe(withViews.get(RunViews));
    expect(without.get(Consumer).tap).toBeUndefined();
  });
});
