import { PROPOSAL_ID } from '../../../../test/fixtures/telegram';
import { LANGUAGES } from '../../../texts/language';
import { textsOf } from '../../../texts/texts';
import {
  MAX_MORE_PROPOSALS,
  OutboundMessage,
  outboundMessageSchema,
} from '../../port/channel.port';
import {
  excessOf,
  keyboardFor,
  MAX_TEXT_UNITS,
  OUTCOME_UNITS,
  outcomeMark,
  renderMessage,
} from './telegram.renderer';

/** The `uk` texts: the wording here is the specification of the Ukrainian catalog. */
const UK = textsOf('uk').telegram;

const SECOND_ID = 'ca7b0e1e-1111-4222-8333-444455557777';

const PACKET: OutboundMessage = {
  noticed: 'Задача «Підписати угоду» стоїть у Waiting For одинадцять днів.',
  whyItMatters: 'Дедлайн проєкту через три дні, і ця задача блокує дві інші.',
  context: 'Відповіді від контрагента немає з пʼятниці.',
  prepared: 'Підготовлено: перевести в Next Action і поставити дату на завтра.',
  ask: 'Написати нагадування самому чи перевести в Next Action?',
  link: 'https://notion.so/page-1',
};

/** A packet with two proposals and their buttons — the way a channel with buttons sees it. */
const PROPOSING: OutboundMessage = {
  ...PACKET,
  proposals: [
    { pendingActionId: PROPOSAL_ID, line: 'Перевести «Підписати угоду» в Next Action' },
    { pendingActionId: SECOND_ID, line: 'Поставити дату перевірки на завтра' },
  ],
  moreProposals: 2,
  actions: [PROPOSAL_ID, SECOND_ID].flatMap((pendingActionId) => [
    { kind: 'approve' as const, pendingActionId },
    { kind: 'reject' as const, pendingActionId },
  ]),
};

describe('decision packet render', () => {
  it('includes all five slots and the link', () => {
    const html = renderMessage(PACKET, UK);

    expect(html).toContain(PACKET.noticed);
    expect(html).toContain(PACKET.whyItMatters);
    expect(html).toContain(PACKET.context);
    expect(html).toContain(PACKET.prepared);
    expect(html).toContain(PACKET.ask);
    expect(html).toContain(PACKET.link);
  });

  it('ends with the ask alone when the message has no link', () => {
    const withoutLink: OutboundMessage = { ...PACKET, link: undefined };
    const html = renderMessage(withoutLink, UK);

    expect(html).toContain(withoutLink.ask);
    expect(html).not.toContain('<a href');
    expect(html).not.toContain(UK.openInNotion);
    expect(html.endsWith('</b>')).toBe(true);
  });

  it('escapes markup instead of breaking the HTML', () => {
    const html = renderMessage({ ...PACKET, noticed: 'a < b & c > d' }, UK);

    expect(html).toContain('a &lt; b &amp; c &gt; d');
  });

  /**
   * A double quote is a legitimate character in a URL path, so the schema lets it through; the
   * escaper keeps the markup intact. Without `&quot;` the link would close the attribute and
   * append an adjacent attribute to the `<a>`, and `parse_mode: HTML` would reject the whole
   * message, and all eight attempts would burn on the same deterministic input.
   */
  it('a quote in the link does not break the href attribute', () => {
    const html = renderMessage({ ...PACKET, link: 'https://notion.so/p1/" onclick="alert(1)' }, UK);

    expect(/<a href="[^"]*">/.test(html)).toBe(true);
    expect(html).toContain('&quot; onclick=&quot;alert(1)');
  });

  /**
   * Shortening happens on the context side: the ask and the link are always kept, because without
   * them the message stops being a decision and becomes noise.
   */
  it('drops an overlong context and keeps the ask and the link', () => {
    const html = renderMessage({ ...PACKET, context: 'к'.repeat(MAX_TEXT_UNITS) }, UK);

    expect(html.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
    expect(html).toContain(PACKET.ask);
    expect(html).toContain(PACKET.link);
    expect(html).not.toContain('к'.repeat(100));
  });

  it('drops an overlong “what has been prepared” after the context', () => {
    const html = renderMessage(
      {
        ...PACKET,
        context: 'коротко',
        prepared: 'п'.repeat(MAX_TEXT_UNITS),
      },
      UK,
    );

    expect(html.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
    expect(html).toContain('коротко');
    expect(html).toContain(PACKET.ask);
  });

  it('truncates an overlong “what was noticed” instead of splitting it into two messages', () => {
    const html = renderMessage(
      {
        ...PACKET,
        noticed: 'н'.repeat(MAX_TEXT_UNITS * 2),
        context: undefined,
        prepared: undefined,
      },
      UK,
    );

    expect(html.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
    expect(html).toContain(PACKET.ask);
    expect(html).toContain(PACKET.link);
    expect(html).toContain('…');
  });
});

describe('proposals', () => {
  it('numbers the lines, and the packet states the rest as a count', () => {
    const html = renderMessage(PROPOSING, UK);

    expect(html).toContain('1. Перевести «Підписати угоду» в Next Action');
    expect(html).toContain('2. Поставити дату перевірки на завтра');
    expect(html).toContain('Ще чекають рішення: 2.');
  });

  it('buttons are one row per proposal, with its number, and hold the intent and the id and nothing more', () => {
    expect(keyboardFor(PROPOSING, UK)).toEqual([
      [
        { text: '1 ✓', callback_data: `approve:${PROPOSAL_ID}` },
        { text: '1 ✕', callback_data: `reject:${PROPOSAL_ID}` },
      ],
      [
        { text: '2 ✓', callback_data: `approve:${SECOND_ID}` },
        { text: '2 ✕', callback_data: `reject:${SECOND_ID}` },
      ],
    ]);
  });

  it('a single proposal gets buttons with words', () => {
    const single: OutboundMessage = {
      ...PROPOSING,
      proposals: PROPOSING.proposals?.slice(0, 1),
      moreProposals: undefined,
    };

    expect(keyboardFor(single, UK)).toEqual([
      [
        { text: '✓ Підтвердити', callback_data: `approve:${PROPOSAL_ID}` },
        { text: '✕ Відхилити', callback_data: `reject:${PROPOSAL_ID}` },
      ],
    ]);
  });

  /** A decision on one proposal does not remove the buttons of the rest. */
  it('a settled proposal gets its fate beside its line and loses only its own buttons', () => {
    const settled = new Map([[PROPOSAL_ID, 'Відхилено']]);

    expect(renderMessage(PROPOSING, UK, settled)).toContain(
      `1. Перевести «Підписати угоду» в Next Action${outcomeMark('Відхилено')}`,
    );
    expect(keyboardFor(PROPOSING, UK, settled)).toEqual([
      [
        { text: '2 ✓', callback_data: `approve:${SECOND_ID}` },
        { text: '2 ✕', callback_data: `reject:${SECOND_ID}` },
      ],
    ]);
  });

  /** The body is measured with a reserve for fates, so it is the same from edit to edit. */
  it('keeps the body of a rewritten message the same as in the sent one', () => {
    const long: OutboundMessage = { ...PROPOSING, context: 'к'.repeat(3_000) };
    const body = (html: string): string => html.slice(0, html.indexOf('1. '));

    expect(body(renderMessage(long, UK, new Map([[PROPOSAL_ID, 'Схвалено — виконується']])))).toBe(
      body(renderMessage(long, UK)),
    );
  });

  it('leaves the proposal lines untouched when shortening', () => {
    const html = renderMessage({ ...PROPOSING, noticed: 'н'.repeat(5_000) }, UK);

    expect(html.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
    expect(html).toContain('2. Поставити дату перевірки на завтра');
    expect(html).toContain('…');
  });
});

/**
 * The renderer's promise is checked by enumeration, not by one example.
 *
 * One example proves nothing: `'н'.repeat(...)` is a character one unit long that escaping does
 * not touch, a class of input on which even cutting an already escaped string would look
 * correct. A split entity and a split surrogate pair show up only on other classes and
 * alignments, so all of them are enumerated.
 */
describe.each(LANGUAGES)('message limit as a theorem (%s)', (language) => {
  const texts = textsOf(language).telegram;

  const CLASSES: readonly [string, string][] = [
    ['ampersands', '&'],
    ['quotes', '"'],
    ['angle brackets', '<'],
    ['emoji', '😀'],
    ['Cyrillic', 'н'],
    ['a mix', '&"<😀н'],
  ];

  /** There can be no cut-off or bare entity in the markup. */
  const SPLIT_ENTITY = /&(?!amp;|lt;|gt;|quot;)/;
  /** A lone surrogate is no longer a character, and JSON with one is not valid UTF-8. */
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  const fill = (unit: string, units: number): string =>
    unit.repeat(Math.ceil(units / unit.length)).slice(0, units);

  it.each(CLASSES)('%s: the result fits the limit and remains markup', (_name, unit) => {
    // The tail is the worst the schema allows: 300 units of ask and a link with quotes, each of
    // which is escaped sixfold.
    const ask = fill(unit, 300);
    const link = `https://notion.so/p?q=${fill('"', 278)}`;

    for (let shift = 0; shift < 8; shift += 1) {
      const message: OutboundMessage = {
        noticed: fill(unit, 5_000 + shift),
        whyItMatters: fill(unit, 1_000),
        context: fill(unit, 2_000),
        prepared: fill(unit, 2_000),
        ask,
        link,
      };

      expect(outboundMessageSchema.safeParse(message).success).toBe(true);

      const html = renderMessage(message, texts);

      expect(html.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
      expect(SPLIT_ENTITY.test(html)).toBe(false);
      expect(LONE_SURROGATE.test(html)).toBe(false);
      expect(html).toContain(escapedTail(ask));
      expect(html).toContain(texts.openInNotion);
    }
  });

  /** The escaped form of the ask is what must arrive whole under any truncation. */
  const escapedTail = (ask: string): string =>
    ask.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** What fits by the measure arrives whole: `noticed` and `why_it_matters` are not cut. */
  it.each(CLASSES)('%s: a packet that fits keeps its body whole', (_name, unit) => {
    let checked = 0;

    for (let units = 100; units <= 4_000; units += 150) {
      const message: OutboundMessage = {
        ...PROPOSING,
        noticed: fill(unit, units),
        whyItMatters: fill(unit, 300),
        context: fill(unit, 2_000),
      };

      if (excessOf(message, texts) > 0) continue;

      const html = renderMessage(message, texts);

      checked += 1;
      expect(html).toContain(escapedTail(message.noticed));
      expect(html).toContain(escapedTail(message.whyItMatters));
    }

    expect(checked).toBeGreaterThan(0);
  });

  it('the excess is exactly how much to shorten by', () => {
    const message: OutboundMessage = { ...PROPOSING, noticed: 'н'.repeat(5_000) };
    const excess = excessOf(message, texts);
    const shortened = (by: number): OutboundMessage => ({
      ...message,
      noticed: message.noticed.slice(by),
    });

    expect(excess).toBeGreaterThan(0);
    expect(excessOf(shortened(excess), texts)).toBe(0);
    expect(excessOf(shortened(excess - 1), texts)).toBe(1);
  });
});

/**
 * A packet that fits (`excessOf` is 0) fits when rewritten with fates too: the renderer reserves
 * `OUTCOME_UNITS` in advance for the fate of each proposal.
 */
describe.each(LANGUAGES)('proposal fates (%s)', (language) => {
  const texts = textsOf(language).telegram;
  const OUTCOMES = Object.entries(textsOf(language).outcomes);

  it.each(OUTCOMES)(
    '“%s” fits the reserve the renderer leaves for each proposal',
    (_fate, outcome) => {
      expect(outcomeMark(outcome).length).toBeLessThanOrEqual(OUTCOME_UNITS);
    },
  );

  /** Builds the longest packet that still fits: `noticed` grows to the limit one unit at a time. */
  const worst = (line: string): OutboundMessage => {
    const base: OutboundMessage = {
      noticed: '&',
      whyItMatters: '"'.repeat(100),
      context: '<'.repeat(2_000),
      prepared: '😀'.repeat(1_000),
      ask: 'Схвалити?',
      link: 'https://notion.so/page-1',
      proposals: [PROPOSAL_ID, SECOND_ID, 'ca7b0e1e-1111-4222-8333-444455558888'].map(
        (pendingActionId) => ({ pendingActionId, line }),
      ),
      moreProposals: 7,
    };
    let noticed = base.noticed;

    while (excessOf({ ...base, noticed: `${noticed}&` }, texts) === 0) noticed += '&';

    return { ...base, noticed };
  };

  it.each(OUTCOMES)(
    '“%s”: a packet at the limit with all fates fits too and keeps its body whole',
    (_f, outcome) => {
      const message = worst('<'.repeat(160));
      const settled = new Map((message.proposals ?? []).map((p) => [p.pendingActionId, outcome]));
      const html = renderMessage(message, texts, settled);

      expect(excessOf(message, texts)).toBe(0);
      expect(html.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
      expect(html).toContain('&amp;'.repeat(message.noticed.length));
      expect(
        renderMessage({ ...message, moreProposals: MAX_MORE_PROPOSALS }, texts, settled).length,
      ).toBeLessThanOrEqual(MAX_TEXT_UNITS);
    },
  );

  it('a packet whose fixed part does not fit does not fit', () => {
    expect(excessOf({ ...worst('&'.repeat(160)), ask: '"'.repeat(300) }, texts)).toBeGreaterThan(0);
  });
});
