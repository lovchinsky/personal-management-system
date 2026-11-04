import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  createSourceFile,
  forEachChild,
  isImportDeclaration,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
  Node,
  ScriptTarget,
} from 'typescript';
import { quotedFrom } from '../../src/attention/attention.service';
import { breakerDelivery } from '../../src/delivery/breaker.message';
import {
  excessOf,
  LINK_LABEL_UNITS,
  MAX_TEXT_UNITS,
  OUTCOME_UNITS,
  outcomeMark,
} from '../../src/delivery/channels/telegram/telegram.renderer';
import { connectionDelivery } from '../../src/delivery/connection.message';
import { Delivery, deliverySchema } from '../../src/delivery/delivery.schema';
import {
  notionGaveUpDelivery,
  notionWaitingDelivery,
} from '../../src/delivery/notion-wait.message';
import { MAX_MORE_PROPOSALS, outboundMessageSchema } from '../../src/delivery/port/channel.port';
import { reviewFailureDelivery } from '../../src/delivery/review-failure.message';
import { wakeFailureDelivery } from '../../src/delivery/wake-failure.message';
import { REVIEW_MODES } from '../../src/reviews/review-modes';
import type { NotionWait } from '../../src/runs/notion-wait-notice';
import { REASONS_REQUESTED_BY_PERSON } from '../../src/runs/provenance';
import { escapeHtml } from '../../src/telegram/telegram-html';
import { GENDERS } from '../../src/texts/gender';
import { LANGUAGES } from '../../src/texts/language';
import { textsOf } from '../../src/texts/texts';
import { canonical } from './contracts';
import { entryText } from './plugin-files';
import { APP, appSources, SRC, within } from './sources';

/**
 * `INV-106` When the App itself writes to the person, it uses only texts from the catalog of the
 * installation's language, and every catalog fits within the channel limits (ADR 0042).
 *
 * The compiler enforces the completeness of a catalog (`satisfies Texts`). This file covers what
 * the compiler cannot see: that the worst-case message of each language passes the queue and fits
 * into one message, that captions and replies are no longer than the limits the renderer rests on,
 * and that text for the person does not appear in code outside the catalog.
 */

/**
 * The App's limit on a button caption: the two buttons of a proposal must fit in one row on a
 * phone.
 */
const BUTTON_LABEL_UNITS = 24;

/** Telegram's limit on the answer to a button press (`answerCallbackQuery`). */
const ANSWER_UNITS = 200;

/**
 * The worst reason: escaping makes a quotation mark six times longer, and the builder truncates
 * the reason.
 */
const WORST_REASON = '"'.repeat(5_000);

/** A key for each kind of period; the 53rd week and September yield the longest captions. */
const KEYS: readonly string[] = ['2026-10-22', '2026-W53', '2026-09', '2026-Q4'];

/**
 * “Today” in another year: the year in the caption of every date is the worst-case length
 * (ADR 0046).
 */
const LONG_AGO = { year: 2000, month: 1, day: 1 };

/**
 * The longest wake times written out in words: the month with the longest name in each language
 * (November, September), a two-digit day, the time 23:59 and the year, because it is not the
 * current one.
 */
const LATEST_MOMENTS: readonly Date[] = [
  new Date('2027-11-30T21:59:00.000Z'),
  new Date('2027-09-30T20:59:00.000Z'),
];

/**
 * The evaluation window of a person's reply that waits for Notion: the texts are fixed, and only
 * the link determines the length.
 */
const NOTION_WAIT: NotionWait = {
  windowId: 'b7c8d9e0-1f2a-4b3c-8d4e-5f6a7b8c9d0e',
  discussionId: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
  pageId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
};

describe.each(LANGUAGES)('INV-106 the “%s” catalog fits within the channel limits', (language) => {
  const texts = textsOf(language);
  const { notices, telegram } = texts;

  const deliveries: readonly (readonly [string, Delivery])[] = [
    ...[1, 2, 5, 11, 21, 22].map(
      (failures) =>
        [
          `breaker after ${failures}`,
          breakerDelivery(
            { lastFailedRunId: 'run-1', reason: WORST_REASON, pageId: null, failures },
            notices.breaker,
          ),
        ] as const,
    ),
    [
      'client connection',
      connectionDelivery(
        { name: '"'.repeat(100), redirectHost: `${'h'.repeat(240)}.example.com` },
        notices.connection,
      ),
    ],
    ...REVIEW_MODES.flatMap((mode) =>
      KEYS.map(
        (occurrenceKey) =>
          [
            `${mode} ${occurrenceKey}`,
            reviewFailureDelivery(
              { mode, occurrenceKey, reason: WORST_REASON },
              notices.reviewFailure,
              language,
              LONG_AGO,
            ),
          ] as const,
      ),
    ),
    ...REASONS_REQUESTED_BY_PERSON.flatMap((reasonCode) =>
      GENDERS.flatMap((gender) =>
        LATEST_MOMENTS.map(
          (runAt) =>
            [
              `wake ${reasonCode}, gender ${gender}, ${runAt.toISOString()}`,
              wakeFailureDelivery(
                {
                  cause: 'check-1:2',
                  reasonCode,
                  pageId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
                  discussionId: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
                  runAt,
                },
                notices.wakeFailure,
                { language, timeZone: 'Europe/Kyiv', gender },
                new Date('2026-12-31T12:00:00.000Z'),
              ),
            ] as const,
        ),
      ),
    ),
    ['the reply waits for Notion', notionWaitingDelivery(NOTION_WAIT, notices.notionWait)],
    ['the reply no longer waits for Notion', notionGaveUpDelivery(NOTION_WAIT, notices.notionWait)],
  ];

  it.each(deliveries)('%s: passes the queue and fits into one message', (_, delivery) => {
    expect(deliverySchema.safeParse(delivery).success).toBe(true);
    expect(outboundMessageSchema.safeParse(delivery.message).success).toBe(true);
    expect(excessOf(delivery.message, telegram)).toBe(0);
  });

  it('the catalog reports its own language', () => {
    expect(texts.language).toBe(language);
  });

  it('each proposal fate fits the reserve that the renderer leaves for it', () => {
    expect(
      Object.values(texts.outcomes).filter(
        (outcome) => outcomeMark(outcome).length > OUTCOME_UNITS,
      ),
    ).toEqual([]);
  });

  it("the link caption is within the limit that the renderer's proof rests on", () => {
    expect(escapeHtml(telegram.openInNotion).length).toBeLessThanOrEqual(LINK_LABEL_UNITS);
  });

  it('button captions and answers to button presses are within their own limits', () => {
    expect(
      Object.values(telegram.buttons).filter((label) => label.length > BUTTON_LABEL_UNITS),
    ).toEqual([]);
    expect(
      Object.values(telegram.answers).filter((answer) => answer.length > ANSWER_UNITS),
    ).toEqual([]);
  });

  /**
   * The renderer computes the reserve for the line about the remainder from the largest number
   * (`moreUnitsOf`): a catalog that writes the number in words with a plural form must keep this
   * line the longest even then.
   */
  it('the line about the remaining proposals is the longest for the largest number', () => {
    const longest = escapeHtml(telegram.moreWaiting(MAX_MORE_PROPOSALS)).length;

    expect(
      [1, 2, 5, 11, 21, 22, 101, 1_001, MAX_MORE_PROPOSALS - 1].filter(
        (count) => escapeHtml(telegram.moreWaiting(count)).length > longest,
      ),
    ).toEqual([]);
  });

  it('the reply to a text with nowhere to land is one message', () => {
    expect(escapeHtml(telegram.nowhere).length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
  });

  /**
   * This reply is also sent as a message in response to a text, not only as the answer to a button
   * press.
   */
  it('the reply to words that were not recorded is one message', () => {
    expect(escapeHtml(telegram.answers.notRecorded).length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
  });
});

/** Cyrillic in a string literal: this is how Ukrainian text for the person appears in code. */
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Finds the string literals of a file that contain Cyrillic, as `path:line`. The text of a tagged
 * template is skipped: `Prisma.sql` contains SQL comments for the reader of the code, not words for
 * the person. Substitutions in a tagged template are not skipped.
 */
function cyrillicLiterals(path: string): string[] {
  const source = createSourceFile(path, readFileSync(path, 'utf8'), ScriptTarget.Latest, true);
  const found: string[] = [];

  const visit = (node: Node): void => {
    if (isTaggedTemplateExpression(node)) {
      if (isTemplateExpression(node.template)) {
        for (const span of node.template.templateSpans) visit(span.expression);
      }

      return;
    }

    const parts =
      isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : isTemplateExpression(node)
          ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
          : [];

    if (parts.some((part) => CYRILLIC.test(part))) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());

      found.push(`${relative(APP, path)}:${line + 1}`);
    }

    forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const TEXTS = resolve(SRC, 'texts');

describe('INV-106 text for the person lives only in the catalogs', () => {
  /**
   * Catches only Cyrillic: English text for the person cannot be told apart from code, errors and
   * logs, which are English by convention. Besides, the goal is to keep Ukrainian out of everything
   * but the `uk` catalog.
   */
  it('outside `texts/` the App code has no Cyrillic string literal', () => {
    expect(
      appSources()
        .filter((path) => !within(TEXTS, path))
        .flatMap(cyrillicLiterals),
    ).toEqual([]);
  });

  /** Otherwise a blind walk that finds no literal would pass silently. */
  it('finds the Ukrainian texts where they must be, in the `uk` catalog', () => {
    expect(cyrillicLiterals(resolve(TEXTS, 'uk.ts')).length).toBeGreaterThan(50);
  });

  /**
   * A catalog is data and the grammar of a language: App logic that would arrive with an import
   * does not live in it.
   */
  it.each(LANGUAGES)('the “%s” catalog imports only types', (language) => {
    const path = resolve(TEXTS, `${language}.ts`);
    const source = createSourceFile(path, readFileSync(path, 'utf8'), ScriptTarget.Latest, true);
    const valueImports = source.statements
      .filter(isImportDeclaration)
      .filter((statement) => statement.importClause?.isTypeOnly !== true)
      .map((statement) => statement.moduleSpecifier.getText(source));

    expect(valueImports).toEqual([]);
  });
});

/**
 * The marker of the person's words from the channel is a protocol between the App and the Skill,
 * not text for the person. The Skill recognizes it verbatim, so it is one marker for all languages,
 * the same as in the Skill.
 */
describe('the channel reply marker is the same one the Skill reads', () => {
  const RUN = canonical.pluginEntries().run;

  it.each(['acting.md', 'frames/event_evaluation.md', 'frames/closure_processing.md'])(
    '%s quotes the App marker',
    (file) => {
      expect(entryText(RUN, file)).toContain(`\`${quotedFrom('<channel>')}\``);
    },
  );
});
