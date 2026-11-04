import { PLUGIN_TOOLS } from '../../src/claude/perimeter';
import { MODES, optionsFor } from '../fixtures/runner-options.fixture';
import { pluginFiles } from './plugin-files';

/** Network calls in the Skill text or the plugin scripts. */
const NETWORK = /\b(?:curl|wget)\s|\bfetch\(|https?\.request\(|\bWebFetch\b|\bWebSearch\b/;

/**
 * `INV-040` The Skill makes no external network calls. On the App-triggered path a mechanism backs
 * this up: built-in tools are disabled, and `WebFetch`/`WebSearch`/`Bash` are in
 * `disallowedTools`.
 *
 * Two layers: the plugin text mentions no network calls, and the run options leave no built-in
 * tool that can reach the network (`Read` in the plugin directory is the only one left), so the
 * external surface of a run is just the three MCP servers (`INV-049`).
 */
describe('INV-040', () => {
  it.each(MODES)(
    'the %s run has only Read in the plugin directory and forbids network tools by name',
    (mode) => {
      const options = optionsFor(mode);

      expect(options.tools).toEqual([...PLUGIN_TOOLS]);
      expect(options.disallowedTools).toEqual(
        expect.arrayContaining(['WebFetch', 'WebSearch', 'Bash']),
      );
    },
  );

  it('the plugin text mentions no network calls', () => {
    const files = pluginFiles(/\.(?:md|json|sh|js|ts|py)$/);
    const calling = files.filter((file) => NETWORK.test(file.text)).map((file) => file.path);

    expect(files.length).toBeGreaterThan(0);
    expect(calling).toEqual([]);
  });
});
