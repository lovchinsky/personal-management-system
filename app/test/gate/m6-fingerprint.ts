import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVALUATION_RESULT_JSON_SCHEMA } from '../../src/claude/result/evaluation-result';
import { digestOf } from '../../src/claude/runner/plugin-digest';

/**
 * Computes the digest of the result schema together with the field descriptions. The descriptions
 * travel in the tool schema, so changing only them changes what the model sees.
 */
export function schemaDigest(): string {
  return digestOf([['evaluation-result', JSON.stringify(EVALUATION_RESULT_JSON_SCHEMA)]]);
}

/**
 * App surfaces outside the gate that determine what the model sees and can do in a run: the tool
 * perimeter, the run profile (model, turns), labels and modes, invocation options, toolsets by
 * mode, the event trigger envelope and the Skill digest by which the gate names what it measures.
 * Different content in them means something else is measured, even when the gate and the Skill
 * are the same. The descriptions and schemas of the App tools are covered by the directories
 * below, and the result schema has its own digest.
 */
export const SURFACE_FILES: readonly string[] = [
  'claude/perimeter',
  'claude/run-profile',
  'claude/result/detector-labels',
  'claude/runner/plugin-digest',
  'claude/runner/run-invocation',
  'runs/toolsets',
  'runs/trigger-envelope',
];

/**
 * App directories whose modules determine what the gate measures: the App tools the model calls,
 * the knowledge layer that the gate uses to build memory pages and parse GBrain answers, and the
 * channel texts and render that the packet length depends on. The gate's own modules are handled
 * separately.
 */
const MEASURING_DIRECTORIES: readonly string[] = [
  'mcp/server/tools',
  'knowledge',
  'texts',
  'delivery/channels/telegram',
];

/** Roots the digest is taken from: App code and gate code, source or built. */
interface DigestRoots {
  readonly app: string;
  readonly gate: string;
}

/**
 * Lists the modules of a directory with the build extension; specs and type declarations are
 * excluded, because the image has none.
 */
function modulesIn(directory: string, extension: string): string[] {
  return readdirSync(directory).filter(
    (name) =>
      name.endsWith(extension) && !name.endsWith(`.spec${extension}`) && !name.endsWith('.d.ts'),
  );
}

/**
 * Computes the gate digest from the content of all gate modules, the App tools, the knowledge layer
 * and the App surfaces the model sees. The gate's modules are not listed by hand: a new module
 * enters the digest by itself, and a forgotten module cannot leave a measurement quietly
 * different. Built modules (`.js`) are read where the gate runs from the image, source ones (`.ts`)
 * in a test; the caller names the extension.
 */
export function gateDigest(roots: DigestRoots, extension: string): string {
  const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');
  const app = [
    ...MEASURING_DIRECTORIES.flatMap((directory) =>
      modulesIn(join(roots.app, directory), extension).map((name) => join(directory, name)),
    ),
    ...SURFACE_FILES.map((name) => `${name}${extension}`),
  ].map((path): [string, string] => [path, read(roots.app, path)]);
  const gate = modulesIn(roots.gate, extension).map((name): [string, string] => [
    join('gate', name),
    read(roots.gate, name),
  ]);

  return digestOf([...app, ...gate]);
}
