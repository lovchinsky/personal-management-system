import {
  initMessage,
  PLUGIN_DIR,
  StreamMessage,
  toolResult,
  toolUse,
} from '../../../test/fixtures/claude-stream.fixture';
import { RunObserver } from './run-observer';

function observedFrom(messages: StreamMessage[]): ReturnType<RunObserver['observed']> {
  const observer = new RunObserver(
    () => [],
    () => undefined,
    PLUGIN_DIR,
  );

  for (const message of messages) observer.see(message);

  return observer.observed();
}

describe('RunObserver: result rejections', () => {
  it("keeps the text of the CLI's rejection of the result against the schema", () => {
    const { rejections } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'StructuredOutput'),
      toolResult('t1', 'Output does not match required schema: /detections/0/type', true),
    ]);

    expect(rejections).toEqual(['Output does not match required schema: /detections/0/type']);
  });

  /**
   * The CLI hands over a tool error in a wrapper; for reading the log the wrapper is superfluous,
   * and the text inside is what the schema said.
   */
  it('strips the CLI wrapper from the rejection text', () => {
    const { rejections } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'StructuredOutput'),
      toolResult(
        't1',
        '<tool_use_error>Output does not match required schema: /detections/0/type</tool_use_error>',
        true,
      ),
    ]);

    expect(rejections).toEqual(['Output does not match required schema: /detections/0/type']);
  });

  /**
   * Truncation belongs to the runner, which redacts first: here the text stays whole so that a
   * secret is not cut in half.
   */
  it('leaves a long text whole: the runner truncates and redacts, not the observer', () => {
    const { rejections } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'StructuredOutput'),
      toolResult('t1', 'x'.repeat(5_000), true),
    ]);

    expect(rejections.map((text) => text.length)).toEqual([5_000]);
  });

  it('lists all rejections of a run in order', () => {
    const { rejections } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'StructuredOutput'),
      toolResult('t1', 'first', true),
      toolUse('t2', 'StructuredOutput'),
      toolResult('t2', 'second', true),
    ]);

    expect(rejections).toEqual(['first', 'second']);
  });

  it('does not count an accepted result or the errors of other tools as rejections', () => {
    const { rejections, toolCalls } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'mcp__notion__notion-fetch'),
      toolResult('t1', 'refused by the server', true),
      toolUse('t2', 'StructuredOutput'),
      toolResult('t2', 'Structured output provided successfully'),
    ]);

    expect(rejections).toEqual([]);
    expect(toolCalls.map((call) => call.ok)).toEqual([false, true]);
  });
});

describe('RunObserver: Skill files read', () => {
  const read = (id: string, path: string, ok = true): StreamMessage[] => [
    toolUse(id, 'Read', { file_path: path }),
    toolResult(id, ok ? 'text' : 'File does not exist', !ok),
  ];

  it('lists paths in order, relative to the plugin directory', () => {
    const { skillReads } = observedFrom([
      initMessage('run-1'),
      ...read('t1', `${PLUGIN_DIR}/skills/run/SKILL.md`),
      ...read('t2', `${PLUGIN_DIR}/skills/run/acting.md`),
      ...read('t3', `${PLUGIN_DIR}/skills/run/SKILL.md`),
    ]);

    expect(skillReads).toEqual([
      'skills/run/SKILL.md',
      'skills/run/acting.md',
      'skills/run/SKILL.md',
    ]);
  });

  it('keeps a rejected read in the list with a mark', () => {
    const { skillReads } = observedFrom([
      initMessage('run-1'),
      ...read('t1', `${PLUGIN_DIR}/skills/run/missing.md`, false),
    ]);

    expect(skillReads).toEqual(['skills/run/missing.md [failed]']);
  });

  it('lists a rejected attempt outside the plugin directory as the model wrote it', () => {
    const { skillReads, breaches } = observedFrom([
      initMessage('run-1'),
      ...read('t1', '/etc/hosts', false),
    ]);

    expect(skillReads).toEqual(['/etc/hosts [failed]']);
    expect(breaches).toEqual([]);
  });

  it('leaves a read without a path and the calls of other tools out of the list', () => {
    const { skillReads } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'Read'),
      toolResult('t1', 'text'),
      toolUse('t2', 'mcp__notion__notion-fetch', { file_path: `${PLUGIN_DIR}/skills/x.md` }),
      toolResult('t2', 'page'),
    ]);

    expect(skillReads).toEqual([]);
  });

  it('records no read for a call that got no response', () => {
    const { skillReads } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'Read', { file_path: `${PLUGIN_DIR}/skills/run/SKILL.md` }),
    ]);

    expect(skillReads).toEqual([]);
  });
});

describe('RunObserver: GBrain calls', () => {
  it("lists GBrain calls only, in order, with the model's arguments", () => {
    const { gbrainCalls } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'mcp__gbrain__search', { query: 'a0865184-6cda-69f0-e8e0-3884c8610ce5' }),
      toolResult('t1', '[]'),
      toolUse('t2', 'mcp__notion__notion-fetch', { id: 'page' }),
      toolResult('t2', 'page'),
      toolUse('t3', 'mcp__gbrain__get_page', { slug: 'projects/a' }),
      toolResult('t3', '{}'),
    ]);

    expect(gbrainCalls).toEqual([
      { tool: 'search', ok: true, input: { query: 'a0865184-6cda-69f0-e8e0-3884c8610ce5' } },
      { tool: 'get_page', ok: true, input: { slug: 'projects/a' } },
    ]);
  });

  it('keeps a rejected call in the list with a failure flag', () => {
    const { gbrainCalls } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'mcp__gbrain__add_timeline_entry', { slug: 'projects/none' }),
      toolResult('t1', 'page_not_found', true),
    ]);

    expect(gbrainCalls).toEqual([
      { tool: 'add_timeline_entry', ok: false, input: { slug: 'projects/none' } },
    ]);
  });

  it('lists calls issued together in issue order, not in the order the responses arrive', () => {
    const { gbrainCalls } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'mcp__gbrain__get_page', { slug: 'projects/a' }),
      toolUse('t2', 'mcp__gbrain__add_timeline_entry', { slug: 'projects/a' }),
      toolResult('t2', '{}'),
      toolResult('t1', '{}'),
    ]);

    expect(gbrainCalls.map((call) => call.tool)).toEqual(['get_page', 'add_timeline_entry']);
  });

  it('does not shift the list for a call without a response or a call without an arguments record', () => {
    const { gbrainCalls } = observedFrom([
      initMessage('run-1'),
      toolUse('t1', 'mcp__gbrain__search', { query: 'q' }),
      toolUse('t2', 'mcp__gbrain__whoami'),
      toolResult('t2', '{}'),
    ]);

    expect(gbrainCalls).toEqual([{ tool: 'whoami', ok: true, input: {} }]);
  });
});
