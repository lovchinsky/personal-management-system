import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** How many characters the digest shows: enough to tell digests apart, short enough to read. */
const DIGEST_CHARS = 12;

/** Computes the digest of named texts. The order does not matter; the name and the content do. */
export function digestOf(parts: readonly (readonly [name: string, text: string])[]): string {
  const hash = createHash('sha256');

  for (const [name, text] of [...parts].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(`${name}\0${text}\0`);
  }

  return hash.digest('hex').slice(0, DIGEST_CHARS);
}

/** Lists the files of a directory, with paths relative to its root. */
function filesUnder(root: string, relative = ''): string[] {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = join(relative, entry.name);

    return entry.isDirectory() ? filesUnder(root, path) : [path];
  });
}

/**
 * Computes the digest of the plugin directory. The digest shows in the run trace and in the gate
 * verdict which Skill a run worked from. Identical content produces an identical digest regardless
 * of place and time.
 */
export function pluginDigest(directory: string): string {
  return digestOf(
    filesUnder(directory).map((path): [string, string] => [
      path,
      readFileSync(join(directory, path), 'utf8'),
    ]),
  );
}

/** The port to the digest, which lets runner tests work without the plugin directory on disk. */
export type PluginDigest = (directory: string) => string;

export const PLUGIN_DIGEST = Symbol('PluginDigest');
