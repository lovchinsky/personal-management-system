import { renderMessage } from '../../src/delivery/channels/telegram/telegram.renderer';
import { outboundMessageSchema } from '../../src/delivery/port/channel.port';
import { textsOf } from '../../src/texts/texts';

/**
 * `INV-024` A channel message is not a source of state. The full content lives in Notion; the
 * message contains a link.
 *
 * Verifiability rests on the field being mandatory, not on the author's habit: a packet without a
 * link fails the schema, so it cannot become a queue row. A mandatory link is what makes
 * at-least-once on the wire acceptable, because two copies point to the same object.
 */
const WITHOUT_LINK = {
  noticed: 'Задача стоїть у Waiting For одинадцять днів.',
  whyItMatters: 'Дедлайн через три дні.',
  ask: 'Перевести в Next Action?',
};

describe('INV-024', () => {
  it('a message without a link fails the schema', () => {
    expect(outboundMessageSchema.safeParse(WITHOUT_LINK).success).toBe(false);
  });

  it('an empty link fails the schema', () => {
    expect(outboundMessageSchema.safeParse({ ...WITHOUT_LINK, link: '' }).success).toBe(false);
  });

  /**
   * Links point into Notion, and they share one protocol. `javascript:` is also a valid URL, so
   * the condition on the protocol rejects it, not the form of the string. The condition rejects
   * it on the way into the queue, not at render, because a queue row survives a restart and is
   * rendered with no chance left to ask where it came from.
   */
  it.each([['javascript:alert(1)'], ['http://notion.so/page-1'], ['notion.so/page-1']])(
    'the link %s fails the schema',
    (link) => {
      expect(outboundMessageSchema.safeParse({ ...WITHOUT_LINK, link }).success).toBe(false);
    },
  );

  /**
   * The limits on `ask` and `link` are load-bearing, not cosmetic: the proof that the render never
   * returns a string longer than the channel's limit rests on them (`telegram.renderer` sets out
   * the arithmetic). Widening them without recomputing the arithmetic silently breaks the theorem,
   * so the numbers have a test of their own.
   */
  it.each([
    ['ask', { ...WITHOUT_LINK, link: 'https://notion.so/p1', ask: 'я'.repeat(301) }],
    ['link', { ...WITHOUT_LINK, link: `https://notion.so/${'p'.repeat(290)}` }],
  ])('an overlong %s fails the schema', (_part, packet) => {
    expect(outboundMessageSchema.safeParse(packet).success).toBe(false);
  });

  it('the link makes it into the render even when the packet is truncated', () => {
    const html = renderMessage(
      { ...WITHOUT_LINK, noticed: 'н'.repeat(20_000), link: 'https://notion.so/page-1' },
      textsOf('uk').telegram,
    );

    expect(html).toContain('https://notion.so/page-1');
  });

  /** The full content is in Notion; the message has no list of state fields. */
  it('a packet consists only of the five decision slots, the link and the buttons', () => {
    const shape = outboundMessageSchema.parse({
      ...WITHOUT_LINK,
      link: 'https://notion.so/page-1',
      context: 'контекст',
      prepared: 'підготовлено',
    });

    expect(Object.keys(shape).sort()).toEqual(
      ['ask', 'context', 'link', 'noticed', 'prepared', 'whyItMatters'].sort(),
    );
  });
});
