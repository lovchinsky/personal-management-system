import { readdirSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { canonicalTree, Invariant, REPO_ROOT } from './contracts';
import {
  anchorsOf,
  CorpusFile,
  fencedLines,
  headingsOf,
  repoFileExists,
  sectionKey,
} from './corpus';

/**
 * The reference forms are exactly those that `docs/README.md` § “Reference forms” describes. Each
 * resolves to its own target. Something that only resembles a form cannot be resolved, so
 * `formViolations` reports a near-miss form as a violation instead of letting it pass silently.
 */
export const FORMS = [
  'invariant',
  'section',
  'contract key',
  'ADR',
  'decision D',
  'RUNBOOK step',
  'defect or gap',
  'conflict',
  'scenario',
  'markdown',
] as const;

export type Form = (typeof FORMS)[number];

/** A reference written outside its form: the check cannot resolve it, so it dangles unnoticed. */
export const PROBLEMS = [
  'section without “”',
  'section in words, not §',
  'section without a document path',
  'section without the closing ”',
  'section number outside RUNBOOK',
  'contract key without a path',
  'contract key not in the form',
  'markdown link instead of §',
  'invariant not in three digits',
  'ADR not in four digits',
] as const;

export type Problem = (typeof PROBLEMS)[number];

export interface Reference {
  readonly form: Form;
  /** The target: `INV-018`, `docs/2-system.md § Scheduler and outbox`, `scheduled_check.rules`. */
  readonly target: string;
  readonly file: string;
  readonly line: number;
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly problem: Problem;
}

interface Flat {
  readonly text: string;
  readonly lineAt: (offset: number) => number;
}

/** Returns the pattern for what a comment or markup puts at the start of a line before the text. */
function continuationOf(path: string): RegExp {
  if (path.endsWith('.md')) return /^[ \t]*(?:>[ \t]*)*/;
  if (/\.(ts|mjs|prisma)$/.test(path)) return /^[ \t]*(?:\/\/\/?|\*(?!\/))?[ \t]*/;
  if (path.endsWith('.sql')) return /^[ \t]*(?:--)?[ \t]*/;

  return /^[ \t]*#?[ \t]*/;
}

/**
 * Flattens the text of a file into one line, without the comment or quote markers at the start of
 * its lines.
 *
 * A reference broken by a line wrap, with “key” on one line and `x` on the next, stays one match,
 * and its line number comes from the map.
 */
export function flatten(path: string, text: string): Flat {
  const marker = continuationOf(path);
  const starts: number[] = [];
  let flat = '';

  for (const line of text.split('\n')) {
    starts.push(flat.length);
    flat += `${line.replace(marker, '')} `;
  }

  return {
    text: flat,
    lineAt: (offset) => {
      let low = 0;
      let high = starts.length - 1;

      while (low < high) {
        const middle = Math.ceil((low + high) / 2);

        if (starts[middle] <= offset) low = middle;
        else high = middle - 1;
      }

      return low + 1;
    },
  };
}

/**
 * Returns the registry without its `origin` fields. Their values are a bare heading without
 * quotes, and the field itself gives their bounds. They are checked separately, from the parsed
 * YAML.
 */
function withoutOrigins(path: string, text: string): string {
  if (path !== 'contracts/invariants.yaml') return text;

  return text.replace(/^[ \t]+- \S+\.md § .*$/gm, '');
}

/**
 * A contract key: the path of a file, possibly as a markdown link, then “key” or “keys” with a list
 * of names in backticks, separated by commas, “and” or “or”.
 */
const CANONICAL =
  /canonical\.yaml`?(?:\]\([^)]*\))?\)?,?\s*[Kk]eys?\s+((?:`[\w.]+`(?:\s*(?:,\s*(?:and|or)?|and|or)\s*)?)+)/gu;

/** In `canonical.yaml` itself, a key is named without a path. */
const OWN_KEY =
  /(?<![\p{L}\p{N}_-])[Kk]eys?\s+((?:`[\w.]+`(?:\s*(?:,\s*(?:and|or)?|and|or)\s*)?)+)/gu;

/** The `Source` column in `docs/4-acceptance.md` writes a key as an anchor of the contract file. */
const CANONICAL_ANCHOR = /contracts\/canonical\.yaml#([\w.]+)/g;

/** `path.md` § “Heading”: the path, possibly in backticks, the § sign and the opening “. */
const SECTION = /([\w./-]+\.md)`?\s*§\s*“/g;

/** A longer “heading” is an unclosed “ that has reached somebody else's ”. */
const LONGEST_HEADING = 200;

/**
 * Returns the position of the ” that pairs with the “ before `start`. A “” inside the heading
 * counts in pairs.
 */
function closingOf(text: string, start: number): number | null {
  let depth = 1;

  for (let at = start; at < text.length && at - start <= LONGEST_HEADING; at += 1) {
    if (text[at] === '“') depth += 1;
    else if (text[at] === '”') depth -= 1;

    if (depth === 0) return at;
  }

  return null;
}

interface Section {
  readonly path: string;
  readonly heading: string;
  readonly offset: number;
}

function sections(path: string, text: string): Section[] {
  return [...text.matchAll(SECTION)].flatMap((match) => {
    const start = match.index + match[0].length;
    const end = closingOf(text, start);

    return end === null
      ? []
      : [{ path: located(path, match[1]), heading: text.slice(start, end), offset: match.index }];
  });
}

/** Resolves a path from the repository root, or else from the directory of the referring file. */
function located(from: string, path: string): string {
  return repoFileExists(path) ? normalize(path) : normalize(join(dirname(from), path));
}

/** Resolves a markdown link target: `/…` starts at the repository root, the rest at the file. */
function linkedPath(from: string, file: string): string {
  if (file === '') return from;
  if (file.startsWith('/')) return normalize(file.slice(1));

  return normalize(join(dirname(from), file));
}

interface Link {
  readonly target: string;
  readonly offset: number;
}

/** Finds inline markdown links and a bare `path.md#anchor` (the `Source` column writes it so). */
function markdownLinks(path: string, text: string): Link[] {
  const links: Link[] = [];

  for (const match of text.matchAll(/\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? match[2];
    if (/^(?:[a-z]+:|\/\/)/i.test(target)) {
      continue;
    }

    const [file, anchor] = target.split('#', 2);
    const resolved = linkedPath(path, file);

    links.push({
      target: anchor === undefined ? resolved : `${resolved}#${anchor}`,
      offset: match.index,
    });
  }

  for (const match of text.matchAll(
    /(?<![(\w/.])((?:docs|contracts|infra)\/[\w./-]+\.md)#([\p{L}\p{M}\p{N}_-]+)/gu,
  )) {
    links.push({ target: `${match[1]}#${match[2]}`, offset: match.index });
  }

  return links;
}

/** Checks whether a form applies to a file: markdown links in documents only, the rest anywhere. */
function inScope(form: Form, file: CorpusFile): boolean {
  return form !== 'markdown' || file.path.endsWith('.md');
}

export function referencesIn(file: CorpusFile): Reference[] {
  const { text, lineAt } = flatten(file.path, withoutOrigins(file.path, file.text));
  const found: Reference[] = [];

  const add = (form: Form, target: string, offset: number): void => {
    if (inScope(form, file)) found.push({ form, target, file: file.path, line: lineAt(offset) });
  };

  for (const match of text.matchAll(/\bINV-\d{3}\b/g)) add('invariant', match[0], match.index);

  for (const section of sections(file.path, text)) {
    add('section', `${section.path} § ${section.heading}`, section.offset);
  }

  const keyForms = file.path === 'contracts/canonical.yaml' ? [CANONICAL, OWN_KEY] : [CANONICAL];
  const keyed = new Set<number>();

  for (const form of keyForms) {
    for (const match of text.matchAll(form)) {
      const list = match.index + match[0].length - match[1].length;

      for (const key of match[1].matchAll(/`([\w.]+)`/g)) {
        const at = list + key.index;

        if (keyed.has(at)) continue;

        keyed.add(at);
        add('contract key', key[1], match.index);
      }
    }
  }

  for (const match of text.matchAll(CANONICAL_ANCHOR)) {
    add('contract key', match[1], match.index);
  }

  for (const match of text.matchAll(/\bADR[ -](\d{4})\b/g)) add('ADR', match[1], match.index);
  for (const match of text.matchAll(/`(D\d{1,2})`|\bdecision:\s*(D\d{1,2})\b/g)) {
    add('decision D', match[1] ?? match[2], match.index);
  }

  const steps =
    file.path === 'infra/RUNBOOK.md' ? /§\s*(\d+(?:\.\d+)*)/g : /RUNBOOK\s*§\s*(\d+(?:\.\d+)*)/g;

  for (const match of text.matchAll(steps)) {
    add('RUNBOOK step', match[1], match.index);
  }

  for (const match of text.matchAll(/\b(?:DEF|GAP)-\d+\b/g)) {
    add('defect or gap', match[0], match.index);
  }

  for (const match of text.matchAll(/`(C\d{1,2})`/g)) {
    add('conflict', match[1], match.index);
  }

  for (const match of text.matchAll(/\bSCEN-\d{2}-\d{1,2}\b/g)) {
    add('scenario', match[0], match.index);
  }

  if (file.path.endsWith('.md')) {
    const fenced = fencedLines(file.text);

    for (const link of markdownLinks(file.path, text)) {
      if (!fenced.has(lineAt(link.offset))) add('markdown', link.target, link.offset);
    }
  }

  return found;
}

/**
 * Returns a section reference for each `origin` of an invariant: the bare heading of the section
 * that states it normatively.
 */
export function originReferences(entries: readonly Invariant[], registryText: string): Reference[] {
  const lines = registryText.split('\n');

  return entries.flatMap((entry) =>
    (entry.origin ?? []).map((origin): Reference => {
      const at = origin.indexOf(' § ');

      return {
        form: 'section',
        target: at < 0 ? origin : `${origin.slice(0, at)} § ${origin.slice(at + 3)}`,
        file: 'contracts/invariants.yaml',
        line: lines.findIndex((line) => line.includes(origin)) + 1,
      };
    }),
  );
}

/**
 * Returns the form violations of a file. A section number outside RUNBOOK is forbidden in
 * documents too; the other forms are for code and contracts, because documents refer to each other
 * with markdown links and RUNBOOK numbers its own steps.
 *
 * A key without a path is a violation only when the name is a top-level key of the contract,
 * because a “key” in code can also be an idempotency key or a configuration key.
 */
export function formViolations(file: CorpusFile, contractKeys: ReadonlySet<string>): Violation[] {
  if (file.path === 'infra/RUNBOOK.md') return [];

  const { text, lineAt } = flatten(file.path, withoutOrigins(file.path, file.text));
  const fenced = file.path.endsWith('.md') ? fencedLines(file.text) : new Set<number>();
  const violations: Violation[] = [];

  const flag = (offset: number, problem: Problem): void => {
    violations.push({ file: file.path, line: lineAt(offset), problem });
  };

  for (const match of text.matchAll(/(?<!RUNBOOK\s*)§\s*\d/g)) {
    if (!fenced.has(lineAt(match.index))) flag(match.index, 'section number outside RUNBOOK');
  }

  if (file.role === 'normative') return violations;

  for (const match of text.matchAll(/\.md`?\s*§(?!\s*“)/g)) flag(match.index, 'section without “”');
  for (const match of text.matchAll(/\.md`?,?\s*(?:in\s+)?section\s*“/g)) {
    flag(match.index, 'section in words, not §');
  }
  for (const match of text.matchAll(/(?<!\.md`?\s*)§\s*“/g)) {
    flag(match.index, 'section without a document path');
  }
  for (const match of text.matchAll(SECTION)) {
    if (closingOf(text, match.index + match[0].length) === null) {
      flag(match.index, 'section without the closing ”');
    }
  }
  for (const match of text.matchAll(
    /\]\([^)\s]*\.md(?:#[^)\s]*)?\)|(?<![\w/.])(?:docs|contracts|infra)\/[\w./-]+\.md#[\p{L}\p{M}\p{N}_-]+/gu,
  )) {
    flag(match.index, 'markdown link instead of §');
  }
  for (const match of text.matchAll(/\bINV-(?:\d{1,2}|\d{4,})\b(?!\$\{)/g)) {
    flag(match.index, 'invariant not in three digits');
  }
  for (const match of text.matchAll(/\bADR(?:[ -]?(?:\d{1,3}|\d{5,})|\d{4})\b/g)) {
    flag(match.index, 'ADR not in four digits');
  }

  if (file.path !== 'contracts/canonical.yaml') {
    const anchored = [...text.matchAll(CANONICAL)].map((match): [number, number] => [
      match.index,
      match.index + match[0].length,
    ]);

    for (const match of text.matchAll(/(?<![\p{L}\p{N}_-])(?:[Kk]eys?|lifecycle)\s+`([\w.]+)`/gu)) {
      const named = contractKeys.has(match[1].split('.')[0]);

      if (named && !anchored.some(([from, to]) => match.index >= from && match.index < to)) {
        flag(match.index, 'contract key without a path');
      }
    }

    // A path followed by a name without the word “key” has no form, so such a key would not
    // resolve and would dangle unnoticed.
    for (const match of text.matchAll(/canonical\.yaml`?\s+`([\w.]+)`/g)) {
      if (contractKeys.has(match[1].split('.')[0])) {
        flag(match.index, 'contract key not in the form');
      }
    }
  }

  return violations;
}

interface Targets {
  readonly invariants: ReadonlySet<string>;
  readonly sections: ReadonlyMap<string, ReadonlySet<string>>;
  readonly anchors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly canonical: Record<string, unknown>;
  readonly decisions: ReadonlySet<string>;
  readonly decisionRows: ReadonlySet<string>;
  readonly runbookSteps: ReadonlySet<string>;
  readonly registers: ReadonlySet<string>;
  readonly conflicts: ReadonlySet<string>;
  readonly scenarios: ReadonlySet<string>;
}

/**
 * Returns the register entries closed by the register's own mark: the statement of a defect starts
 * with “**Closed…**”, and a gap has “closed” in the “Blocks” column.
 */
export function closedRegistersIn(plan: string): Set<string> {
  return new Set([
    ...[...plan.matchAll(/^\| \*\*(DEF-\d+)\*\* \| \*\*Closed/gm)].map((m) => m[1]),
    ...[...plan.matchAll(/^\| \*\*(GAP-\d+)\*\* \|.*\| closed[^|]*\|\s*$/gm)].map((m) => m[1]),
  ]);
}

function textOf(corpus: readonly CorpusFile[], path: string): string {
  const file = corpus.find((candidate) => candidate.path === path);
  if (!file) {
    throw new Error(`${path} is not in the corpus`);
  }

  return file.text;
}

function conflictIds(contract: Record<string, unknown>): Set<string> {
  const conflicts = contract.conflicts;

  if (!Array.isArray(conflicts)) return new Set();

  return new Set(
    conflicts.flatMap((conflict: unknown) =>
      typeof conflict === 'object' &&
      conflict !== null &&
      'id' in conflict &&
      typeof conflict.id === 'string'
        ? [conflict.id]
        : [],
    ),
  );
}

export function targetsOf(corpus: readonly CorpusFile[], entries: readonly Invariant[]): Targets {
  const markdown = corpus.filter((file) => file.path.endsWith('.md'));
  const contract = canonicalTree();
  const plan = textOf(corpus, 'docs/5-plan.md');
  const acceptance = textOf(corpus, 'docs/4-acceptance.md');

  return {
    invariants: new Set(entries.map((entry) => entry.id)),
    sections: new Map(
      markdown.map((file) => [
        file.path,
        new Set(headingsOf(file.text).map((h) => sectionKey(h.text))),
      ]),
    ),
    anchors: new Map(markdown.map((file) => [file.path, anchorsOf(file.text)])),
    canonical: contract,
    decisions: new Set(
      readdirSync(resolve(REPO_ROOT, 'docs/decisions')).flatMap(
        (name) => /^(\d{4})-/.exec(name)?.[1] ?? [],
      ),
    ),
    decisionRows: new Set(
      [...plan.matchAll(/^\| \[\d{4}\]\([^)]*\) \| `(D\d+)` \|/gm)].map((m) => m[1]),
    ),
    runbookSteps: new Set(
      headingsOf(textOf(corpus, 'infra/RUNBOOK.md')).flatMap(
        (heading) => /^(\d+(?:\.\d+)*)\.\s/.exec(heading.text)?.[1] ?? [],
      ),
    ),
    registers: new Set([...plan.matchAll(/^\| \*\*((?:DEF|GAP)-\d+)\*\* \|/gm)].map((m) => m[1])),
    conflicts: conflictIds(contract),
    scenarios: new Set([
      ...[...acceptance.matchAll(/^\| (SCEN-\d{2}-\d{1,2}) \|/gm)].map((m) => m[1]),
      ...[...acceptance.matchAll(/^#+ (SCEN-\d{2}-\d{1,2})\b/gm)].map((m) => m[1]),
    ]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keyExists(contract: Record<string, unknown>, path: string): boolean {
  let node: unknown = contract;

  for (const segment of path.split('.')) {
    if (!isRecord(node) || !(segment in node)) return false;

    node = node[segment];
  }

  return true;
}

/** Decodes the anchor of a link, which may be encoded; a malformed %-sequence leads nowhere. */
function decoded(anchor: string): string | null {
  try {
    return decodeURIComponent(anchor);
  } catch (error) {
    if (error instanceof URIError) return null;

    throw error;
  }
}

function linkResolves(target: string, targets: Targets): boolean {
  const [path, anchor] = target.split('#', 2);

  // A link outside the repository would check the machine the test runs on.
  if (path.startsWith('..') || !repoFileExists(path)) return false;
  if (anchor === undefined) return true;

  const name = decoded(anchor);

  return name !== null && (targets.anchors.get(path)?.has(name) ?? false);
}

export function resolves(reference: Reference, targets: Targets): boolean {
  switch (reference.form) {
    case 'invariant':
      return targets.invariants.has(reference.target);
    case 'section': {
      const at = reference.target.indexOf(' § ');
      if (at < 0) {
        return false;
      }

      const path = reference.target.slice(0, at);
      const heading = reference.target.slice(at + 3);

      return targets.sections.get(path)?.has(sectionKey(heading)) ?? false;
    }
    case 'contract key':
      return keyExists(targets.canonical, reference.target);
    case 'ADR':
      return targets.decisions.has(reference.target);
    case 'decision D':
      return targets.decisionRows.has(reference.target);
    case 'RUNBOOK step':
      return targets.runbookSteps.has(reference.target);
    case 'defect or gap':
      return targets.registers.has(reference.target);
    case 'conflict':
      return targets.conflicts.has(reference.target);
    case 'scenario':
      return targets.scenarios.has(reference.target);
    case 'markdown':
      return linkResolves(reference.target, targets);
  }
}

export function show(reference: Reference): string {
  return `${reference.file}:${reference.line} ${reference.form} → ${reference.target}`;
}
