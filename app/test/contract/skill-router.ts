import { canonical } from './contracts';
import { entryFiles, entryText } from './plugin-files';

/** A router row: a situation and the files it loads first and when needed. */
interface RouterRow {
  /**
   * The first cell: the `mode` in the run entry, a description of the situation in the Chat entry.
   */
  readonly situation: string;
  readonly first: readonly string[];
  readonly whenNeeded: readonly string[];
}

/** Lists the files a cell names: the `*.md` paths in backticks. */
function filesIn(cell: string): string[] {
  return [...cell.matchAll(/`([a-z0-9_/-]+\.md)`/g)].map((match) => match[1]);
}

/**
 * Returns the rows of the Markdown table whose header starts with `header`, leaving out the header
 * and the separator.
 */
function tableRows(text: string, header: string): string[][] {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.split('|')[1]?.trim().startsWith(header));

  if (at < 0) return [];

  const rows: string[][] = [];

  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith('|')) break;

    rows.push(line.split('|').slice(1, -1));
  }

  return rows;
}

const RUN = canonical.pluginEntries().run;
const CHAT = canonical.pluginEntries().chat;

/** The directory where the run entry looks for knowledge: the `knowledge/` of the Chat entry. */
export const KNOWLEDGE = `skills/${CHAT}/knowledge/`;

/**
 * Reads the router of the run entry: `mode` → files, as paths from the plugin root. A name
 * without a directory is a file of the entry itself. A name with `knowledge/` is knowledge that
 * lives in the Chat entry.
 */
export function runRouter(): RouterRow[] {
  const pathOf = (file: string): string =>
    file.startsWith('knowledge/') ? `skills/${CHAT}/${file}` : `skills/${RUN}/${file}`;

  return tableRows(entryText(RUN, 'SKILL.md'), '`mode`').map(([mode, first, later]) => ({
    situation: mode.trim().replaceAll('`', ''),
    first: filesIn(first).map(pathOf),
    whenNeeded: filesIn(later).map(pathOf),
  }));
}

/**
 * Reads the router of the Chat entry: situation → files, as paths from the plugin root (the names
 * in the table are relative to the entry's directory).
 */
export function chatRouter(): RouterRow[] {
  return tableRows(entryText(CHAT, 'SKILL.md'), 'The person').map(([who, first, later]) => ({
    situation: who.trim(),
    first: filesIn(first).map((file) => `skills/${CHAT}/${file}`),
    whenNeeded: filesIn(later).map((file) => `skills/${CHAT}/${file}`),
  }));
}

/** Returns the size in bytes of a plugin file, given its path from the plugin root. */
export function sizeOf(path: string): number {
  const all = [...entryFiles(RUN), ...entryFiles(CHAT)];

  return Buffer.byteLength(all.find((file) => file.path === path)?.text ?? '');
}

/** Lists the files of an entry except `SKILL.md`, as paths from the plugin root. */
export function entryParts(entry: string): string[] {
  return entryFiles(entry)
    .map((file) => file.path)
    .filter((path) => !path.endsWith('/SKILL.md'));
}

/** Returns the text of a plugin file, given its path from the plugin root. */
export function textOf(path: string): string {
  const all = [...entryFiles(RUN), ...entryFiles(CHAT)];

  return all.find((file) => file.path === path)?.text ?? '';
}

/**
 * Returns the body of an entry's `SKILL.md` without table lines, which is what the entry says
 * outside the router.
 */
export function entryProse(entry: string): string {
  return entryText(entry, 'SKILL.md')
    .split('\n')
    .filter((line) => !line.startsWith('|'))
    .join('\n');
}

/** Lists the file names from the router of the run entry as written there, from its directory. */
export function runRouterNames(): string[] {
  return [
    ...new Set(
      tableRows(entryText(RUN, 'SKILL.md'), '`mode`').flatMap(([, first, later]) => [
        ...filesIn(first),
        ...filesIn(later),
      ]),
    ),
  ];
}
