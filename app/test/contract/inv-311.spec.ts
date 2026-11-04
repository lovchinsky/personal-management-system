import { PLUGIN_TOOLS, pluginReadRule } from '../../src/claude/perimeter';
import { RunObserver } from '../../src/claude/runner/run-observer';
import {
  initMessage,
  PLUGIN_DIR,
  resultMessage,
  StreamMessage,
  toolResult,
  toolUse,
} from '../fixtures/claude-stream.fixture';
import { MODES, optionsFor } from '../fixtures/runner-options.fixture';

const REFERENCE = `${PLUGIN_DIR}/skills/run/knowledge/ontology.md`;

/**
 * Feeds a read to the observer and reports what it said: whether the run was stopped and which
 * breaches it named.
 */
function observedRead(path: string, denied: boolean): { stopped: string[]; breaches: string[] } {
  const stopped: string[] = [];
  const observer = new RunObserver(
    () => [],
    (reason) => stopped.push(reason),
    PLUGIN_DIR,
  );
  const messages: StreamMessage[] = [
    initMessage('run-1'),
    toolUse('r1', 'Read', { file_path: path }),
    toolResult('r1', denied ? 'denied' : 'file text', denied),
    resultMessage('run-1'),
  ];

  for (const message of messages) observer.see(message);

  return { stopped, breaches: [...observer.observed().breaches] };
}

/**
 * `INV-311` The only built-in tool of an App-triggered run is `Read`, and it is limited to the
 * plugin directory: a successful read of a file outside it is a run failure, no matter which allow
 * entry the CLI gave. A denied attempt is not a failure.
 *
 * Two layers: the permission rule in the options of every mode and the stream observer. That the
 * CLI itself rejects a read outside the directory, symlinks and `..` included, is measured on the
 * pinned CLI and checked by gate M3.
 */
describe('INV-311', () => {
  it.each(MODES)(
    'options for %s allow `Read` only by a rule with the absolute plugin path',
    (mode) => {
      const options = optionsFor(mode);

      expect(options.tools).toEqual([...PLUGIN_TOOLS]);
      expect(options.allowedTools).toContain(pluginReadRule(PLUGIN_DIR));
      // A single `/` starts a path from the run's cwd, so a rule written that way allows nothing.
      expect(pluginReadRule(PLUGIN_DIR)).toBe('Read(//app/plugin/**)');
      expect(options.allowedTools?.filter((rule) => rule === 'Read' || rule === 'Read(*)')).toEqual(
        [],
      );
    },
  );

  it('reading a file in the plugin directory is not a breach', () => {
    expect(observedRead(REFERENCE, false)).toEqual({ stopped: [], breaches: [] });
  });

  it('a denied attempt to read outside the directory is not a breach but a perimeter action', () => {
    expect(observedRead('/etc/passwd', true)).toEqual({ stopped: [], breaches: [] });
  });

  it.each([
    ['an absolute path outside the directory', '/etc/passwd'],
    ['leaving the directory through ..', `${PLUGIN_DIR}/skills/../../secrets.env`],
    ['a relative path', 'knowledge/ontology.md'],
    ['the directory itself, not a file in it', PLUGIN_DIR],
  ])('%s: a successful read is a breach and the run is stopped', (_, path) => {
    const seen = observedRead(path, false);

    expect(seen.breaches).toEqual([expect.stringContaining(path)]);
    expect(seen.stopped).toEqual(['perimeter breach']);
  });
});
