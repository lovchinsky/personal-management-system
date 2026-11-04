import { canonical } from './contracts';
import { entryFiles } from './plugin-files';
import { KNOWLEDGE } from './skill-router';

const CHAT = canonical.pluginEntries().chat;
const RUN = canonical.pluginEntries().run;

/**
 * Signs of a run that the Chat entry and the knowledge must not mention: the envelope, applying the
 * writes after the result, the run itself as a situation, dispatch, frames. Each pattern marks a
 * place where one of these signs could already have crept in.
 */
const RUN_MARKERS: readonly (readonly [RegExp, string])[] = [
  [/\benvelope\b/i, 'envelope'],
  [/\bstaged\b/i, 'writes that wait for the result'],
  [/\bApp run\b|\bin a run\b|\bthis run\b|\bevery run\b|\ba run\b/i, 'a run as a situation'],
  [/\bdispatch(?:ed|es)?\b/i, 'dispatch'],
  [/\bframes?\b/i, 'frame'],
  [/\bperson_speaks\b/, 'a run flag'],
];

/** Signs of Chat that the run entry and the knowledge must not mention. */
const CHAT_MARKERS: readonly (readonly [RegExp, string])[] = [[/\bChat\b/, 'Chat as a situation']];

/** Removes what is in backticks, which is a capability name or a value, not prose. */
function prose(text: string): string {
  return text.replace(/`[^`\n]*`/g, '');
}

function found(
  files: readonly { path: string; text: string }[],
  markers: readonly (readonly [RegExp, string])[],
): string[] {
  return files.flatMap((file) =>
    prose(file.text)
      .split('\n')
      .flatMap((text, at) =>
        markers
          .filter(([marker]) => marker.test(text))
          .map(([, why]) => `${file.path}:${at + 1} ${why}: ${text.trim().slice(0, 90)}`),
      ),
  );
}

/**
 * `INV-315` A surface has its own entry; knowledge knows nothing of the surface.
 *
 * The check is static and partial: it catches the words of another surface in files they do not
 * belong in. A file that avoids the words and still explains how the agent was launched is left to
 * editorial judgment, as in `INV-314`.
 */
describe('INV-315', () => {
  const chatOwn = entryFiles(CHAT).filter((file) => !file.path.startsWith(KNOWLEDGE));
  const knowledge = entryFiles(CHAT).filter((file) => file.path.startsWith(KNOWLEDGE));
  const runOwn = entryFiles(RUN);

  it('there is something to check', () => {
    expect(chatOwn.length).toBeGreaterThan(0);
    expect(knowledge.length).toBeGreaterThan(0);
    expect(runOwn.length).toBeGreaterThan(0);
  });

  it('the Chat entry does not speak of runs', () => {
    expect(found(chatOwn, RUN_MARKERS)).toEqual([]);
  });

  it('the run entry does not speak of Chat', () => {
    expect(found(runOwn, CHAT_MARKERS)).toEqual([]);
  });

  it('the knowledge speaks neither of runs nor of Chat', () => {
    expect(found(knowledge, [...RUN_MARKERS, ...CHAT_MARKERS])).toEqual([]);
  });
});
