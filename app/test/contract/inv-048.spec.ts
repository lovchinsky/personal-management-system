import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_DIR } from '../fixtures/claude-stream.fixture';
import { MODES, optionsFor } from '../fixtures/runner-options.fixture';
import { canonical, repoFile } from './contracts';
import { CHAT_PLUGIN_ROOT, RUNNER_PLUGIN_ROOT } from './plugin-files';

const ENTRIES = canonical.pluginEntries();
const KNOWLEDGE = `plugin/skills/${ENTRIES.chat}/knowledge`;

const dockerfile = repoFile('app/Dockerfile');
const workdir = [...dockerfile.matchAll(/^WORKDIR\s+(\S+)/gm)].map(([, dir]) => dir).at(-1) ?? '/';
const declared = /^ENV\s+RUNNER_PLUGIN_DIR=(\S+)/m.exec(dockerfile)?.[1];

/**
 * The stage that both `runtime` and `gate` inherit: the gate does not see what is copied outside
 * it.
 */
const base = dockerfile.slice(
  dockerfile.indexOf(' AS app-base'),
  dockerfile.indexOf('FROM app-base AS gate'),
);
const copies = [...base.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+)\s+(\S+)$/gm)].map(
  ([, source, target]) => ({ source, target: resolve(workdir, target ?? '') }),
);

/**
 * `INV-048` Every execution surface has its own plugin, while the domain knowledge lives in one
 * place: the chat plugin is installed from the `plugin/` directory at a pinned commit, and the App
 * image assembles the runner plugin from the runner's entry and the same knowledge and attaches it
 * as `plugins: [{ type: 'local', path, skipMcpDiscovery: true }]`.
 *
 * The check runs over the build: the knowledge exists once in the repository, and the image places
 * it where the run entry reads its names from.
 */
describe('INV-048', () => {
  it.each(MODES)(
    'the %s run loads exactly the runner plugin, without the plugin MCP servers',
    (mode) => {
      expect(optionsFor(mode).plugins).toEqual([
        { type: 'local', path: resolve(PLUGIN_DIR), skipMcpDiscovery: true },
      ]);
    },
  );

  it('the image places the runner plugin where RUNNER_PLUGIN_DIR points', () => {
    expect(declared).toBe(PLUGIN_DIR);
    expect(copies.find((copy) => copy.source === 'app/plugin')?.target).toBe(declared);
  });

  it('the image places the knowledge of the chat plugin in the run entry directory, on top of the plugin itself', () => {
    const sources = copies.map((copy) => copy.source);

    expect(copies.find((copy) => copy.source === KNOWLEDGE)?.target).toBe(
      `${declared}/skills/${ENTRIES.run}/knowledge`,
    );
    expect(sources.indexOf('app/plugin')).toBeLessThan(sources.indexOf(KNOWLEDGE));
  });

  it('the knowledge exists once: in the Chat entry, not in the run entry', () => {
    expect(existsSync(resolve(CHAT_PLUGIN_ROOT, 'skills', ENTRIES.chat, 'knowledge'))).toBe(true);
    expect(existsSync(resolve(RUNNER_PLUGIN_ROOT, 'skills', ENTRIES.run, 'knowledge'))).toBe(false);
  });

  /**
   * The scan covers the whole Dockerfile: the `runtime` stage too takes nothing from the chat
   * plugin except the knowledge.
   */
  it('the chat plugin does not ship in the image: only the knowledge directory is taken from it', () => {
    const sources = [...dockerfile.matchAll(/^COPY\s+(?:--\S+\s+)*(.+)$/gm)].flatMap(([, line]) =>
      (line ?? '').trim().split(/\s+/).slice(0, -1),
    );

    expect(sources.filter((source) => /^\.?\/?plugin(?:\/|$)/.test(source))).toEqual([KNOWLEDGE]);
  });
});
