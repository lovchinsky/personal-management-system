import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { REPO_ROOT } from './contracts';
import { allSources } from './sources';

/**
 * The corpus in which references live: code, contracts and documents.
 *
 * The role of a file decides what is checked in it (`docs/README.md` § “Reference forms”). ADRs and
 * appendices are documents like the rest: they describe what is in force.
 */
type Role = 'code' | 'contract' | 'normative';

export interface CorpusFile {
  /** The path from the repository root. */
  readonly path: string;
  readonly role: Role;
  readonly text: string;
}

/** The files of the check itself: their samples deliberately name what does not exist. */
export const CHECKER: readonly string[] = [
  'app/test/contract/corpus.ts',
  'app/test/contract/references.ts',
  'app/test/contract/references.spec.ts',
  'app/test/contract/final-state.spec.ts',
];

/**
 * The directories the corpus does not see: dependencies, build output, generated code, applied
 * migrations and secrets.
 */
const SKIPPED: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  'generated',
  'migrations',
  '.secrets',
]);

function filesUnder(dir: string, accept: (path: string) => boolean): string[] {
  const found: string[] = [];

  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) visit(absolute);
      } else if (accept(relative(REPO_ROOT, absolute))) {
        found.push(relative(REPO_ROOT, absolute));
      }
    }
  };

  visit(resolve(REPO_ROOT, dir));

  return found.sort();
}

const md = (path: string): boolean => path.endsWith('.md');

function codeFiles(): string[] {
  return [
    ...allSources()
      .map((file) => relative(REPO_ROOT, file))
      .sort(),
    'app/prisma/schema.prisma',
    'app/prisma.config.ts',
    'app/Dockerfile',
    'app/eslint.config.mjs',
    'app/.gitignore',
    'app/.prettierignore',
    '.gitignore',
    '.dockerignore',
    'infra/.env.example',
    'infra/postgres/init.sql',
    // Only the top level of `infra/`: deeper are installation files that the test does not read.
    ...readdirSync(resolve(REPO_ROOT, 'infra'))
      .filter((name) => /^compose[^/]*\.ya?ml$/.test(name))
      .map((name) => `infra/${name}`)
      .sort(),
    ...filesUnder('infra/docker', (path) => path.endsWith('Dockerfile')),
    'infra/caddy/Caddyfile',
    ...filesUnder('infra/ops', (path) => path.endsWith('.sh')),
    ...filesUnder('infra/bin', () => true),
  ].filter((path) => !CHECKER.includes(path));
}

const CONTRACTS: readonly string[] = [
  'contracts/canonical.yaml',
  'contracts/invariants.yaml',
  'contracts/notion-workspace.yaml',
];

function normativeFiles(): string[] {
  return [
    ...filesUnder('docs', (path) => /^docs\/[^/]+\.md$/.test(path)),
    'contracts/README.md',
    'infra/RUNBOOK.md',
    'infra/GATE.md',
    'README.md',
    'CONTRIBUTING.md',
    'app/README.md',
    ...['docs/decisions', 'docs/appendix'].flatMap((dir) => filesUnder(dir, md)),
  ];
}

export function loadCorpus(): CorpusFile[] {
  const read = (path: string, role: Role): CorpusFile => ({
    path,
    role,
    text: readFileSync(resolve(REPO_ROOT, path), 'utf8'),
  });

  return [
    ...codeFiles().map((path) => read(path, 'code')),
    ...CONTRACTS.map((path) => read(path, 'contract')),
    ...normativeFiles().map((path) => read(path, 'normative')),
  ];
}

export function repoFileExists(path: string): boolean {
  return existsSync(resolve(REPO_ROOT, path));
}

interface Heading {
  readonly text: string;
  readonly line: number;
}

/**
 * Returns the numbers of the lines inside fenced blocks, the fences themselves included.
 *
 * A block is closed by a fence of the same character that is no shorter than the opening one and
 * has nothing after it, so a block of four backticks can contain three.
 */
export function fencedLines(text: string): ReadonlySet<number> {
  const inside = new Set<number>();
  let open: { readonly char: string; readonly length: number } | null = null;

  for (const [index, line] of text.split('\n').entries()) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);

    if (open === null) {
      if (marker) {
        open = { char: marker[1][0], length: marker[1].length };
        inside.add(index + 1);
      }

      continue;
    }

    inside.add(index + 1);

    const closes =
      marker !== null &&
      marker[1][0] === open.char &&
      marker[1].length >= open.length &&
      marker[2].trim() === '';

    if (closes) {
      open = null;
    }
  }

  return inside;
}

/** Returns the headings outside fenced blocks: a `#` in a fence is a shell comment. */
export function headingsOf(text: string): Heading[] {
  const fenced = fencedLines(text);

  return text.split('\n').flatMap((line, index) => {
    const heading = fenced.has(index + 1) ? null : /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);

    return heading ? [{ text: heading[1], line: index + 1 }] : [];
  });
}

/**
 * Computes the slug of a heading by the GitHub algorithm (`github-slugger`): the visible text is
 * lowercased and stripped of everything except letters, marks, decimal digits, spaces, `-` and `_`;
 * spaces become hyphens. Nothing is trimmed, so a character that disappears at the start leaves a
 * hyphen. The Unicode properties are the engine's, not the frozen table of `github-slugger`, so
 * letters added to Unicode later stay here and vanish on GitHub; the corpus has none.
 */
export function slug(heading: string): string {
  return heading
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Returns the key of a section for `§ “Heading”`; the section number is not part of the name. */
export function sectionKey(heading: string): string {
  return slug(heading.replace(/^\d+(?:\.\d+)*\.?\s+/, ''));
}

/**
 * Computes the anchors of a file: the slug of every heading and the explicit `<a id|name>` outside
 * code.
 *
 * A repeat is numbered as in `github-slugger`: it takes the first free suffix, so the headings x,
 * x, x-1 give x, x-1, x-1-1.
 */
export function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();

  for (const heading of headingsOf(text)) {
    const base = slug(heading.text);
    let anchor = base;

    while (occurrences.has(anchor)) {
      const count = (occurrences.get(base) ?? 0) + 1;

      occurrences.set(base, count);
      anchor = `${base}-${count}`;
    }

    occurrences.set(anchor, 0);
    anchors.add(anchor);
  }

  const fenced = fencedLines(text);

  text.split('\n').forEach((line, index) => {
    if (fenced.has(index + 1)) return;

    const outsideCode = line.replace(/`[^`]*`/g, '');

    for (const match of outsideCode.matchAll(/<a\s[^>]*?(?<=\s)(?:id|name)="([^"]+)"/g)) {
      anchors.add(match[1]);
    }
  });

  return anchors;
}
