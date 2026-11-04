import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { canonical, REPO_ROOT, repoFile } from './contracts';
import {
  CHAT_PLUGIN_ROOT,
  marketplaceTemplate,
  pluginEntries,
  RUNNER_PLUGIN_ROOT,
  skillFiles,
} from './plugin-files';

const mcp = z
  .object({ mcpServers: z.record(z.string(), z.object({ type: z.string(), url: z.string() })) })
  .parse(JSON.parse(readFileSync(resolve(CHAT_PLUGIN_ROOT, '.mcp.json'), 'utf8')));

const runnerManifest = z
  .object({ name: z.string() })
  .catchall(z.unknown())
  .parse(
    JSON.parse(readFileSync(resolve(RUNNER_PLUGIN_ROOT, '.claude-plugin/plugin.json'), 'utf8')),
  );

const template = marketplaceTemplate();
const entry = template.plugins[0];

/** Lists the Skills a plugin contains: the directories, without the system's service files. */
function skillsOf(root: string): string[] {
  return readdirSync(resolve(root, 'skills'), { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name);
}

/**
 * `INV-043` The core Personal Management System Plugin uses Skills and three MCP connectors and
 * does not depend on commands, hooks or sub-agents.
 *
 * The check runs over the plugin directory and the installation's marketplace template: the skills
 * exist, there are exactly three connectors, and there are no `commands/`, `agents/` or `hooks/`
 * directories. The real addresses live in the installation, so the template keeps the shape of
 * the connectors.
 */
describe('INV-043', () => {
  /** Many checks read the Skill walk: they would silently skip an entry that dropped out of it. */
  it('the Skill walk finds both entries', () => {
    expect(skillFiles().map((file) => file.path)).toEqual(
      expect.arrayContaining(
        Object.values(canonical.pluginEntries()).map((name) => `skills/${name}/SKILL.md`),
      ),
    );
  });

  it('each plugin contains exactly its own entry: the run entry does not reach the chat plugin', () => {
    expect(skillsOf(CHAT_PLUGIN_ROOT)).toEqual([canonical.pluginEntries().chat]);
    expect(skillsOf(RUNNER_PLUGIN_ROOT)).toEqual([canonical.pluginEntries().run]);
  });

  it('there are exactly three connectors — app, notion, gbrain — and all are HTTP', () => {
    const servers = ['app', 'gbrain', 'notion'];

    expect(Object.keys(canonical.mcpToolsets()).sort()).toEqual(servers);
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(servers);
    expect(
      [...Object.values(mcp.mcpServers), ...Object.values(entry.mcpServers)].map(
        (server) => server.type,
      ),
    ).toEqual(Array.from({ length: 5 }, () => 'http'));
  });

  /**
   * Notion has a fixed address in the plugin, so the entry overrides only the installation's
   * servers.
   */
  it('the marketplace entry overrides exactly the App and GBrain', () => {
    expect(Object.keys(entry.mcpServers).sort()).toEqual(['app', 'gbrain']);
  });

  /**
   * The addresses of the App and GBrain belong to the installation: the plugin takes them from
   * variables and does not contain them.
   */
  it('only Notion has an address in the plugin: the App and GBrain take theirs from variables', () => {
    expect(mcp.mcpServers.app?.url).toBe('${APP_MCP_URL}');
    expect(mcp.mcpServers.gbrain?.url).toBe('${GBRAIN_MCP_URL}');
    expect(mcp.mcpServers.notion?.url).toMatch(/^https:\/\//);
  });

  it('the template contains no installation addresses: only placeholders, as in the environment template', () => {
    const environment = repoFile('infra/.env.example');

    expect(entry.mcpServers.app?.url).toBe('https://<APP_DOMAIN>/mcp');
    expect(entry.mcpServers.gbrain?.url).toBe('https://<GBRAIN_DOMAIN>/mcp');
    expect(environment).toContain('https://<APP_DOMAIN>/mcp');
    expect(environment).toContain('https://<GBRAIN_DOMAIN>/mcp');
    expect(template.owner.name).toBe('<OWNER>');
    expect(entry.source.url).toBe('https://github.com/<OWNER>/personal-management-system.git');
    expect(entry.source.sha).toBe('<COMMIT_SHA>');
  });

  /**
   * claude.ai accepts an entry without a manifest only with `strict: false`, and `sha` pins the
   * source.
   */
  it('the template entry points to the chat plugin directory', () => {
    expect(entry.name).toBe(canonical.pluginEntries().chat);
    expect(entry.strict).toBe(false);
    expect(entry.source.source).toBe('git-subdir');
    expect(entry.source.ref).toBe('main');
    expect(entry.source.path).toBe(relative(REPO_ROOT, CHAT_PLUGIN_ROOT));
  });

  /**
   * A manifest in the plugin directory would silently disable the `mcpServers` of the marketplace
   * entry.
   */
  it('the marketplace entry is the manifest of the chat plugin: the project has none', () => {
    expect(existsSync(resolve(CHAT_PLUGIN_ROOT, '.claude-plugin'))).toBe(false);
    expect(existsSync(resolve(REPO_ROOT, '.claude-plugin'))).toBe(false);
  });

  it.each(['commands', 'agents', 'hooks', 'bin'])(
    'there is no %s directory in any plugin',
    (name) => {
      expect(pluginEntries().filter((path) => path.split('/')[0] === name)).toEqual([]);
    },
  );

  it.each(['commands', 'agents', 'hooks', 'mcpServers'])(
    'the runner plugin manifest does not declare %s',
    (name) => {
      expect(runnerManifest).not.toHaveProperty(name);
    },
  );

  it('the connectors contain no credentials', () => {
    expect(JSON.stringify([mcp, entry.mcpServers])).not.toMatch(
      /authorization|bearer|api[_-]?key|secret|token/i,
    );
  });
});
