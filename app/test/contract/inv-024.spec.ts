import { renderMessage } from '../../src/delivery/channels/telegram/telegram.renderer';
import { deliveryWireSchema } from '../../src/delivery/delivery.wire';
import { outboundMessageSchema } from '../../src/delivery/port/channel.port';
import { textsOf } from '../../src/texts/texts';

/**
 * `INV-024` A channel message is not a source of state. The full content lives in Notion; a
 * message about a Notion object contains a link to it.
 *
 * Verifiability rests on the field being mandatory where the message is about Notion content, not
 * on the author's habit: a packet the model queues without a link fails the wire schema, so it
 * cannot become a queue row. A link is what makes at-least-once on the wire acceptable, because
 * two copies point to the same object. A notice the App writes about the system itself (a client
 * connected, a review did not take place) is about no Notion object and has no link.
 */
const WITHOUT_LINK = {
  noticed: 'Задача стоїть у Waiting For одинадцять днів.',
  whyItMatters: 'Дедлайн через три дні.',
  ask: 'Перевести в Next Action?',
};

describe('INV-024', () => {
  it('a packet the model queues without a link fails the wire schema', () => {
    const wire = {
      channel: 'telegram',
      message: {
        noticed: WITHOUT_LINK.noticed,
        why_it_matters: WITHOUT_LINK.whyItMatters,
        ask: WITHOUT_LINK.ask,
      },
    };

    expect(deliveryWireSchema.safeParse(wire).success).toBe(false);
    expect(
      deliveryWireSchema.safeParse({
        ...wire,
        message: { ...wire.message, link: 'https://notion.so/page-1' },
      }).success,
    ).toBe(true);
  });

  /** A notice about the system has no Notion object to point to, and no empty caption stands in. */
  it('a notice about the system has no link, and its render has no caption', () => {
    expect(outboundMessageSchema.safeParse(WITHOUT_LINK).success).toBe(true);

    const html = renderMessage(WITHOUT_LINK, textsOf('uk').telegram);

    expect(html).toContain(WITHOUT_LINK.ask);
    expect(html).not.toContain('<a href');
    expect(html).not.toContain(textsOf('uk').telegram.openInNotion);
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
