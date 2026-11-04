import {
  INTENT_ONLY,
  LESSONS,
  PROMISE_ENGLISH,
  PROMISE_TOMORROW,
  PROMISE_UNDATED,
  THIRD_PARTY,
} from '../gate/m6-phrasing';
import { clientOf, plantedMemoryOf, SCENARIOS, SINGLE_RUNS, worldOf } from '../gate/m6-scenarios';
import {
  DECISION_RESTATED,
  DECISION_STATED,
  FACT_STATED,
  ROUTINE_ANSWER,
  STANDARD_STATED,
} from '../gate/m7-phrasing';
import { SUBJECT_STEM } from '../gate/m7-scenarios';
import { FIXTURE_SPECS } from '../gate/m8-fixtures';
import { C1_THREADS, D1_PROPOSAL_QUESTION, S1_THREADS, X1_NOTE } from '../gate/m8-scenarios';
import type { SystemNotice } from '../gate/m9-evidence';
import {
  AP1_DONE,
  AP1_NOTICE,
  AP1_YES,
  AP2_NOTICE,
  AP2_NOW,
  AP2_START,
  AP3_PROPOSAL,
  AP4_MOVE,
  AP4_NOTICE,
  AP5_NOTICE,
} from '../gate/m9-scenarios';
import { pluginFiles } from './plugin-files';

/**
 * How many consecutive words make a match verbatim: shorter sequences are language, longer ones
 * are a copy.
 */
const WORDS = 4;

const TAG = '4821-u1-1';

/** Returns the words of a text in lowercase, without punctuation. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

/** Returns all sequences of `WORDS` words of a text. */
function sequencesOf(text: string): Set<string> {
  const words = wordsOf(text);

  return new Set(
    Array.from({ length: Math.max(0, words.length - WORDS + 1) }, (_, index) =>
      words.slice(index, index + WORDS).join(' '),
    ),
  );
}

/** Returns the sequences shared by two texts. */
function sharedSequences(a: string, b: string): string[] {
  const other = sequencesOf(b);

  return [...sequencesOf(a)].filter((sequence) => other.has(sequence));
}

/**
 * Collects everything the gate says to the model: the person's words, memory lessons, thread
 * openings and the page names of the worlds.
 */
function gateStrings(): string[] {
  const client = clientOf(TAG);
  const phrases = [PROMISE_TOMORROW, PROMISE_UNDATED, PROMISE_ENGLISH, INTENT_ONLY, THIRD_PARTY]
    .flat()
    .map((phrase) => phrase(client));
  const said = [ROUTINE_ANSWER, DECISION_STATED, DECISION_RESTATED, FACT_STATED, STANDARD_STATED]
    .flat()
    .map((phrase) => phrase(`${SUBJECT_STEM}-${TAG}`));
  const lessons = LESSONS.flatMap((lesson) => [
    lesson('Orvex-4821', 'юристи').join(' '),
    lesson('Orvex-4821', 'юристи замовника «Меридіан-4821»').join(' '),
  ]);
  const openings = Object.values(SINGLE_RUNS).flatMap((spec) =>
    spec?.trigger.kind === 'reply' ? [spec.trigger.opening] : [],
  );
  const memory = SCENARIOS.flatMap((info) =>
    plantedMemoryOf(info.id, TAG).flatMap((page) => [
      page.title,
      ...page.paragraphs,
      ...(page.kind === 'anchor'
        ? [
            ...(page.timeline ?? []).flatMap((item) => [item.summary, item.source]),
            ...(page.facts ?? []),
          ]
        : []),
    ]),
  );
  const pages = SCENARIOS.flatMap((info) =>
    worldOf(info.id, TAG).flatMap((page) => [
      page.name,
      ...(page.body ?? []),
      ...(page.type === 'inbox_item' && page.text !== undefined ? [page.text] : []),
    ]),
  );
  const planted = FIXTURE_SPECS.flatMap((spec) => [
    spec.title,
    spec.text,
    ...(spec.question === undefined ? [] : [spec.question]),
  ]);
  const notice = (words: SystemNotice): string[] => [
    words.thread,
    words.noticed,
    words.whyItMatters,
    words.ask,
  ];
  const threads = [
    ...S1_THREADS.flatMap((thread) => [thread.question, thread.answer]),
    ...Object.values(C1_THREADS).map((thread) => thread.text),
    D1_PROPOSAL_QUESTION,
    X1_NOTE,
    ...[AP1_NOTICE, AP2_NOTICE, AP4_NOTICE, AP5_NOTICE, AP3_PROPOSAL.notice].flatMap(notice),
    AP3_PROPOSAL.notice.line,
    ...AP1_DONE,
    ...AP1_YES,
    ...AP2_START,
    ...AP2_NOW,
    ...AP4_MOVE.map((move) => move('7 листопада')),
  ];

  return [
    ...phrases,
    ...said,
    ...lessons,
    ...openings,
    ...memory,
    ...pages,
    ...planted,
    ...threads,
  ];
}

/**
 * A Skill written for the test passes the test instead of doing the work. An example in the Skill
 * that matches a gate scenario line verbatim would check the memory of the example, not
 * recognition. So the gate lines the model sees do not repeat the plugin text even for `WORDS`
 * words in a row.
 */
describe('gate lines and the Skill text', () => {
  const plugin = pluginFiles();

  it('finds a match: four consecutive words are a copy, three are language', () => {
    expect(
      sharedSequences('Я обіцяв надіслати пропозицію завтра', 'Тож я обіцяв надіслати пропозицію.'),
    ).toEqual(['я обіцяв надіслати пропозицію']);
    expect(sharedSequences('Я обіцяв надіслати пропозицію', 'Він обіцяв надіслати щось')).toEqual(
      [],
    );
  });

  it('a match does not depend on case or punctuation', () => {
    expect(sharedSequences("Maybe, I'll send it.", 'maybe I ll send IT')).toEqual([
      'maybe i ll send',
      'i ll send it',
    ]);
  });

  it('there are enough gate lines for the check to check anything', () => {
    expect(gateStrings().length).toBeGreaterThan(40);
    expect(plugin.length).toBeGreaterThan(10);
  });

  it('no gate line repeats the Skill verbatim', () => {
    const copies = plugin.flatMap((file) =>
      gateStrings().flatMap((text) =>
        sharedSequences(text, file.text).map((sequence) => `${file.path}: «${sequence}»`),
      ),
    );

    expect([...new Set(copies)]).toEqual([]);
  });
});
