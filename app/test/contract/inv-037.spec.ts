import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DISPATCHED_MODES } from '../../src/runs/trigger-envelope';
import { canonical } from './contracts';
import { CHAT_PLUGIN_ROOT, entryFiles, pluginLinks, RUNNER_PLUGIN_ROOT } from './plugin-files';
import {
  chatRouter,
  entryParts,
  entryProse,
  KNOWLEDGE,
  runRouter,
  runRouterNames,
  sizeOf,
  textOf,
} from './skill-router';

const CHAT = canonical.pluginEntries().chat;
const RUN = canonical.pluginEntries().run;

/**
 * How many bytes a situation loads on its first read: the entry and the files its router names for
 * it. The ceiling is the measured read plus a small margin, not a target: otherwise what is read
 * first grows unnoticed, and the rest of the knowledge stays “when needed”. Every mode reads the
 * system's voice (ADR 0046) and the rules for an unavailable Notion (ADR 0045), so every ceiling
 * has room for them.
 */
const CEILING: Readonly<Record<string, number>> = {
  dialogue: 32_000,
  event_evaluation: 45_500,
  scheduled_recheck: 39_800,
  closure_processing: 28_400,
  daily_control: 28_700,
  weekly_control_review: 36_900,
  strategic_review: 35_900,
  deep_review: 28_800,
};
const CHAT_CEILING = 26_000;

/**
 * Limits per file: what is read in full must not grow. The entry is the router and the rules of
 * every situation, together with the voice (ADR 0046) and the assistant name (ADR 0049); its limit
 * is the measured run entry plus ≈ 3%.
 */
const ENTRY_CEILING = 5_475;
const PART_CEILING = 6_000;
const KNOWLEDGE_CEILING = 12_000;

/**
 * `INV-037` Every Skill entry contains only what its situation needs: the run entry holds the
 * files of its `mode`, the Chat entry holds the files of the conversation situation.
 *
 * The check is mechanical and has two parts: the entry's router names exactly the frames the
 * contract declares, each with its file; and the volume a situation loads on its first read does
 * not exceed the ceiling. Whether every sentence in these files is needed is an editorial
 * judgment.
 */
describe('INV-037', () => {
  const run = runRouter();
  const chat = chatRouter();
  const existing = new Set([...entryFiles(RUN), ...entryFiles(CHAT)].map((file) => file.path));

  it('the run entry router is exactly the contract frames, in the contract order, and all are dispatched', () => {
    expect(run.map((row) => row.situation)).toEqual(canonical.runFrames());
    expect(canonical.runFrames().filter((mode) => !(mode in canonical.workflowModes()))).toEqual(
      [],
    );
  });

  it('the contract frames are exactly the modes the App dispatches', () => {
    expect(canonical.runFrames()).toEqual([...DISPATCHED_MODES]);
  });

  it('the frames directory is exactly the contract frames', () => {
    const frames = entryParts(RUN)
      .filter((path) => path.startsWith(`skills/${RUN}/frames/`))
      .map((path) => path.slice(`skills/${RUN}/frames/`.length).replace(/\.md$/, ''));

    // The directory returns files in alphabetical order, while the order of the modes belongs to
    // the contract and the router, so the set of files is what matters for the directory.
    expect([...frames].sort()).toEqual([...canonical.runFrames()].sort());
  });

  it('every file named in the routers exists', () => {
    const named = [...run, ...chat].flatMap((row) => [...row.first, ...row.whenNeeded]);

    expect(named.filter((path) => !existing.has(path))).toEqual([]);
  });

  /**
   * The run agent reads files relative to the directory of its entry, as it reads `SKILL.md`
   * itself, so the names in the table are relative paths and no path is composed from two places.
   * In the repository the knowledge lives in the Chat entry, and the image build places it in the
   * directory of the run entry (`INV-048`).
   */
  it('every name in the run router exists where the image takes it from', () => {
    const own = resolve(RUNNER_PLUGIN_ROOT, 'skills', RUN);
    const chat = resolve(CHAT_PLUGIN_ROOT, 'skills', CHAT);
    const unreadable = runRouterNames().filter(
      (name) => !existsSync(resolve(name.startsWith('knowledge/') ? chat : own, name)),
    );

    expect(unreadable).toEqual([]);
  });

  /**
   * A link becomes a text file in a build without link support, and `Read` does not let it through
   * to the outside.
   */
  it('there are no links in the plugins', () => {
    expect(pluginLinks()).toEqual([]);
  });

  it('every file of an entry is reachable from its router', () => {
    const reached = (rows: typeof run): Set<string> =>
      new Set(rows.flatMap((row) => [...row.first, ...row.whenNeeded]));

    const runReached = reached(run);
    const chatReached = reached(chat);

    expect(entryParts(RUN).filter((path) => !runReached.has(path))).toEqual([]);
    expect(
      entryParts(CHAT)
        .filter((path) => !path.startsWith(KNOWLEDGE))
        .filter((path) => !chatReached.has(path)),
    ).toEqual([]);
    expect(
      entryParts(CHAT)
        .filter((path) => path.startsWith(KNOWLEDGE))
        .filter((path) => !chatReached.has(path) && !runReached.has(path)),
    ).toEqual([]);
  });

  /**
   * A reference in the text is a route too: the agent follows it just as it follows a router row. A
   * file that the text of an entry refers to must be in the router of that same entry. Otherwise
   * the entry leads to a file that it does not itself mention. Names in the knowledge files are
   * relative to the knowledge directory; names in the other files of the entry are relative to the
   * entry's directory.
   */
  it.each([
    ['Chat', CHAT, chat],
    ['run', RUN, run],
  ] as const)(
    'every reference in the files of the %s entry leads to a file in its router',
    (_label, entry, rows) => {
      const reached = new Set(rows.flatMap((row) => [...row.first, ...row.whenNeeded]));
      const targetOf = (from: string, name: string): string => {
        if (name.startsWith('knowledge/')) return `skills/${CHAT}/${name}`;
        if (from.startsWith(KNOWLEDGE)) return `${KNOWLEDGE}${name}`;

        return `skills/${entry}/${name}`;
      };
      const astray = [`skills/${entry}/SKILL.md`, ...reached].flatMap((from) =>
        [...textOf(from).matchAll(/`((?:[a-z-]+\/)*[a-z-]+\.md)`/g)]
          .map((match) => targetOf(from, match[1] ?? ''))
          .filter((target) => !reached.has(target))
          .map((target) => `${from} -> ${target}`),
      );

      expect(reached.size).toBeGreaterThan(0);
      expect(astray).toEqual([]);
    },
  );

  it.each(Object.entries(CEILING))(
    'the first read of mode %s fits under the ceiling',
    (mode, ceiling) => {
      const row = run.find((candidate) => candidate.situation === mode);
      const files = [`skills/${RUN}/SKILL.md`, ...(row?.first ?? [])];
      const total = files.reduce((sum, path) => sum + sizeOf(path), 0);

      expect(row).toBeDefined();
      expect(total).toBeLessThanOrEqual(ceiling);
    },
  );

  it('there is a ceiling for every contract frame', () => {
    expect(canonical.runFrames().filter((mode) => !(mode in CEILING))).toEqual([]);
  });

  it('the first read of every conversation situation fits under the ceiling', () => {
    const over = chat
      .map((row) => ({
        situation: row.situation,
        total: [`skills/${CHAT}/SKILL.md`, ...row.first].reduce(
          (sum, path) => sum + sizeOf(path),
          0,
        ),
      }))
      .filter((row) => row.total > CHAT_CEILING);

    expect(chat.length).toBeGreaterThan(0);
    expect(over).toEqual([]);
  });

  /**
   * When to read a file is decided by where the agent reaches it from: the entry router or a
   * sentence in another file. The agent sees the first line of the file itself only after
   * deciding to open it, so a “read this when…” line decides nothing and only adds a second place
   * for the rule, and that place diverges from the first.
   */
  it('no file other than an entry starts with a line saying when to read it', () => {
    const opening = /^(?:Read this|Use this|Load this|You are here)\b/;
    const found = [...entryParts(RUN), ...entryParts(CHAT)].flatMap((path) => {
      const first = textOf(path)
        .split('\n')
        .find((line, at) => at > 0 && line.trim() !== '' && !line.startsWith('#'));

      return first !== undefined && opening.test(first) ? [`${path}: ${first.slice(0, 80)}`] : [];
    });

    expect(found).toEqual([]);
  });

  /**
   * The agent opens a file from the “Read when needed” column prompted by a word in the text it
   * has already read: in Chat, a sentence of the entry outside the table; in a run, a file the
   * mode reads first or a file that a first-read file has already sent the agent to. A file that
   * no chain leads to from what is read first would stay unreachable.
   */
  it('every file in the “Read when needed” column is named where the agent reaches it from', () => {
    const named = (text: string, path: string): boolean =>
      new RegExp(`\\b${path.split('/').pop()?.replace('.', '\\.')}`).test(text);
    const chatProse = entryProse(CHAT);
    const reached = (row: (typeof run)[number]): Set<string> => {
      const opened = new Set<string>(row.first);

      for (let grew = true; grew;) {
        grew = false;

        for (const path of row.whenNeeded) {
          if (!opened.has(path) && [...opened].some((from) => named(textOf(from), path))) {
            opened.add(path);
            grew = true;
          }
        }
      }

      return opened;
    };
    const orphans = [
      ...chat.flatMap((row) =>
        row.whenNeeded
          .filter((path) => !chatProse.includes(`\`${path.replace(`skills/${CHAT}/`, '')}\``))
          .map((path) => `${row.situation.slice(0, 40)}: ${path}`),
      ),
      ...run.flatMap((row) => {
        const opened = reached(row);

        return row.whenNeeded
          .filter((path) => !opened.has(path))
          .map((path) => `${row.situation}: ${path}`);
      }),
    ];

    expect(orphans).toEqual([]);
  });

  it('no file grows beyond its limit', () => {
    const over = [...entryFiles(RUN), ...entryFiles(CHAT)]
      .map((file) => {
        const limit = file.path.endsWith('/SKILL.md')
          ? ENTRY_CEILING
          : file.path.startsWith(KNOWLEDGE)
            ? KNOWLEDGE_CEILING
            : PART_CEILING;

        return { path: file.path, size: Buffer.byteLength(file.text), limit };
      })
      .filter((file) => file.size > file.limit)
      .map((file) => `${file.path}: ${file.size} > ${file.limit}`);

    expect(over).toEqual([]);
  });
});
