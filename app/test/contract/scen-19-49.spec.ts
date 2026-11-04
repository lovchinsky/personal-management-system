import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { SKILL_NAME } from '../../src/claude/runner/run-invocation';
import { canonical, repoFile } from './contracts';
import { entryText, marketplaceTemplate, RUNNER_PLUGIN_ROOT } from './plugin-files';

function manifestOf(root: string): { name: string } {
  return z
    .object({ name: z.string() })
    .parse(JSON.parse(readFileSync(resolve(root, '.claude-plugin/plugin.json'), 'utf8')));
}

/** Reads `name` and `description` from the frontmatter of an entry's `SKILL.md`. */
function frontmatter(entry: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(entryText(entry, 'SKILL.md'))?.[1] ?? '';

  return Object.fromEntries(
    [...block.matchAll(/^([a-z-]+):\s*(.+)$/gm)].map((match) => [match[1], match[2]]),
  );
}

const ENTRIES = canonical.pluginEntries();

/**
 * `SCEN-19-49` Both execution surfaces — interactive and App-triggered — apply the same domain
 * knowledge: it is stored once, and the surfaces take it from one commit.
 *
 * The image build is checked by `INV-048`. This test checks that each surface has something to
 * load, and that the entry name the runner uses to invoke a run is the one the plugin actually
 * declares.
 */
describe('SCEN-19-49', () => {
  it('the chat plugin has something to load: an entry in the marketplace template, connectors and its own entry', () => {
    expect(marketplaceTemplate().plugins[0].name).toBe(ENTRIES.chat);
    expect(repoFile('plugin/.mcp.json')).toContain('mcpServers');
    expect(repoFile(`plugin/skills/${ENTRIES.chat}/SKILL.md`)).toMatch(/^---\n/);
  });

  it('the runner plugin has something to load: a manifest and its own entry, but no connectors', () => {
    expect(manifestOf(RUNNER_PLUGIN_ROOT).name).toBe('personal-management-system-runner');
    expect(repoFile(`app/plugin/skills/${ENTRIES.run}/SKILL.md`)).toMatch(/^---\n/);
    expect(() => repoFile('app/plugin/.mcp.json')).toThrow();
  });

  /** The runner's command is `/<plugin>:<skill>`; the plugin itself names both parts. */
  it('the entry name the runner uses to invoke a run matches the one the plugin declares', () => {
    expect(SKILL_NAME).toBe(
      `${manifestOf(RUNNER_PLUGIN_ROOT).name}:${frontmatter(ENTRIES.run).name}`,
    );
  });

  /**
   * Chat finds an entry by its `description`; without one, or with one that is too long, the entry
   * does not load.
   */
  it.each(Object.values(ENTRIES))(
    'the description of entry %s exists and fits the limit',
    (entry) => {
      const { description, name } = frontmatter(entry);

      expect(description.length).toBeGreaterThan(80);
      expect(description.length).toBeLessThanOrEqual(1024);
      expect(name).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(name).toBe(entry);
    },
  );
});
