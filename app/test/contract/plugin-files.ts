import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { REPO_ROOT, repoFile } from './contracts';

/**
 * The chat plugin: it has no manifest, because the installation's marketplace entry is its manifest
 * (`infra/marketplace.example.json`).
 */
export const CHAT_PLUGIN_ROOT = resolve(REPO_ROOT, 'plugin');

/**
 * The runner plugin: it sits next to the App and gets its knowledge when the image is built
 * (`INV-048`).
 */
export const RUNNER_PLUGIN_ROOT = resolve(REPO_ROOT, 'app/plugin');

const PLUGIN_ROOTS = [CHAT_PLUGIN_ROOT, RUNNER_PLUGIN_ROOT];

/**
 * The shape of the entry is strictly closed: `version` or `oauth` in the template would silently
 * change the plugin's behavior.
 */
const marketplaceTemplateSchema = z.strictObject({
  name: z.string(),
  owner: z.strictObject({ name: z.string() }),
  description: z.string(),
  plugins: z.tuple([
    z.strictObject({
      name: z.string(),
      displayName: z.string(),
      description: z.string(),
      strict: z.boolean(),
      source: z.strictObject({
        source: z.string(),
        url: z.string(),
        path: z.string(),
        ref: z.string(),
        sha: z.string(),
      }),
      mcpServers: z.record(z.string(), z.strictObject({ type: z.string(), url: z.string() })),
    }),
  ]),
});

/** Reads the marketplace template of the installation. */
export function marketplaceTemplate(): z.infer<typeof marketplaceTemplateSchema> {
  return marketplaceTemplateSchema.parse(JSON.parse(repoFile('infra/marketplace.example.json')));
}

interface PluginFile {
  /** The path from the root of its own plugin. */
  readonly path: string;
  /** The path from the repository root. */
  readonly repoPath: string;
  readonly text: string;
}

/**
 * Lists the content of a plugin directory: files, directories and links. The walk does not enter
 * links.
 */
function walk(directory: string): { absolute: string; kind: 'file' | 'directory' | 'link' }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);

    if (entry.isSymbolicLink()) return [{ absolute, kind: 'link' as const }];
    if (entry.isDirectory()) {
      return [{ absolute, kind: 'directory' as const }, ...walk(absolute)];
    }

    return [{ absolute, kind: 'file' as const }];
  });
}

/** Reads the files of a directory inside a plugin. The caller selects the extensions. */
function filesUnder(root: string, directory: string, accept: RegExp): PluginFile[] {
  return walk(directory)
    .filter((entry) => entry.kind === 'file' && accept.test(entry.absolute))
    .map((entry) => ({
      path: relative(root, entry.absolute),
      repoPath: relative(REPO_ROOT, entry.absolute),
      text: readFileSync(entry.absolute, 'utf8'),
    }));
}

function byPath(a: PluginFile, b: PluginFile): number {
  return a.path.localeCompare(b.path);
}

/** Reads all files of both plugins. The caller selects the extensions. */
export function pluginFiles(accept = /\.(?:md|json)$/): PluginFile[] {
  return PLUGIN_ROOTS.flatMap((root) => filesUnder(root, root, accept)).sort(byPath);
}

/** Lists the paths of all the content of both plugins: files, directories and links. */
export function pluginEntries(): string[] {
  return PLUGIN_ROOTS.flatMap((root) =>
    walk(root).map((entry) => relative(root, entry.absolute)),
  ).sort();
}

/** Lists the links of both plugins as paths from the repository root. */
export function pluginLinks(): string[] {
  return PLUGIN_ROOTS.flatMap((root) => walk(root))
    .filter((entry) => entry.kind === 'link')
    .map((entry) => relative(REPO_ROOT, entry.absolute));
}

/** Reads the Skill files of both entries, with paths from the root of their plugin. */
export function skillFiles(): PluginFile[] {
  return PLUGIN_ROOTS.flatMap((root) =>
    filesUnder(root, resolve(root, 'skills'), /\.(?:md|json)$/),
  ).sort(byPath);
}

/** Returns the files of one Skill entry, with paths from the plugin root: `skills/<entry>/…`. */
export function entryFiles(entry: string): PluginFile[] {
  return skillFiles().filter((file) => file.path.startsWith(`skills/${entry}/`));
}

/**
 * Returns the text of an entry file by its path from the entry directory: `knowledge/ontology.md`.
 */
export function entryText(entry: string, path: string): string {
  return entryFiles(entry).find((file) => file.path === `skills/${entry}/${path}`)?.text ?? '';
}
