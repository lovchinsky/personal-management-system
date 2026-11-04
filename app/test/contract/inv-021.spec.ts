import { TELEGRAM_CAPABILITIES } from '../../src/delivery/channels/telegram/telegram.channel';
import { keyboardFor, renderMessage } from '../../src/delivery/channels/telegram/telegram.renderer';
import {
  ChannelCapabilities,
  NotificationChannel,
  OutboundMessage,
  outboundMessageSchema,
} from '../../src/delivery/port/channel.port';
import { packetFor } from '../../src/delivery/port/packet';
import { textsOf } from '../../src/texts/texts';
import { PROPOSAL_ID } from '../fixtures/telegram';

/**
 * `INV-021` Buttons derive from proposals: for a channel that supports them, the sender adds
 * “approve” and “reject” to each proposal, and for a channel without them, none; in both cases the
 * packet carries the proposal lines, the question and the link.
 *
 * The degradation mechanism lives not in the channel but in the form of the packet: the decision
 * is contained in the proposal lines and `ask`, and the place to act on it is the mandatory
 * link. Buttons derive from proposals, and the sender adds them only for a channel that supports
 * them. A channel without buttons remains a carrier of the decision, not an empty “something
 * happened” signal.
 */
const PACKET: OutboundMessage = {
  noticed: 'Задача стоїть у Waiting For одинадцять днів.',
  whyItMatters: 'Дедлайн через три дні.',
  ask: 'Перевести в Next Action?',
  link: 'https://notion.so/page-1',
  proposals: [{ pendingActionId: PROPOSAL_ID, line: 'Перевести задачу в Next Action' }],
};

/** A channel that only declares what it is. */
const channelWith = (interactiveActions: boolean): NotificationChannel => ({
  id: 'telegram',
  capabilities: { interactiveActions },
  excess: () => 0,
  send: () => Promise.resolve({ ok: true }),
});

describe('INV-021', () => {
  it('a packet without buttons stays a carrier of the decision', () => {
    const packet = packetFor(channelWith(false), PACKET);
    const html = renderMessage(packet, textsOf('uk').telegram);

    expect(html).toContain('1. Перевести задачу в Next Action');
    expect(html).toContain(PACKET.ask);
    expect(html).toContain(PACKET.link);
    expect(keyboardFor(packet, textsOf('uk').telegram)).toEqual([]);
  });

  it('for a channel with buttons the sender adds buttons to each proposal', () => {
    expect(packetFor(channelWith(true), PACKET).actions).toEqual([
      { kind: 'approve', pendingActionId: PROPOSAL_ID },
      { kind: 'reject', pendingActionId: PROPOSAL_ID },
    ]);
  });

  /**
   * Capabilities are declared by the channel, and they are where a consumer learns about
   * degradation. This test checks only that Telegram supports buttons; what the sender **does**
   * with the flag is in `scen-19-33`.
   *
   * The port declares only what someone reads. A declaration without a consumer guarantees
   * nothing, and a test that compares it with the same constant the channel takes it from checks
   * nothing.
   */
  it('Telegram declares button support', () => {
    const capabilities: ChannelCapabilities = TELEGRAM_CAPABILITIES;

    expect(capabilities.interactiveActions).toBe(true);
  });

  it('a packet without proposals stays a valid message', () => {
    expect(outboundMessageSchema.safeParse({ ...PACKET, proposals: undefined }).success).toBe(true);
  });
});
