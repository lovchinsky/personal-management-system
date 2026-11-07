import { chatDeliveryKey, runDeliveryKey } from './delivery-key';
import { DeliveryRequest } from './delivery.schema';

const PACKET: Pick<DeliveryRequest, 'channel' | 'discussionId' | 'message'> = {
  channel: 'telegram',
  message: {
    noticed: 'Задача чекає на відповідь',
    whyItMatters: 'Вона блокує критичний шлях',
    ask: 'Позначити як виконану?',
    link: 'https://www.notion.so/page-1',
  },
};

describe('delivery key', () => {
  describe('of a run', () => {
    it('the same cause yields the same key', () => {
      expect(runDeliveryKey('evt-1')).toBe(runDeliveryKey('evt-1'));
    });

    it('a different cause yields a different key, so the next wake of a thread has its own delivery', () => {
      expect(runDeliveryKey('check-1:1')).not.toBe(runDeliveryKey('check-1:2'));
    });
  });

  describe('of a chat', () => {
    it('the same packet yields the same key, in whatever order the fields are named', () => {
      const reordered: typeof PACKET = {
        message: {
          link: PACKET.message.link,
          ask: PACKET.message.ask,
          whyItMatters: PACKET.message.whyItMatters,
          noticed: PACKET.message.noticed,
        },
        channel: 'telegram',
      };

      expect(chatDeliveryKey(reordered)).toBe(chatDeliveryKey(PACKET));
    });

    it('a different question or a different thread yields a different key', () => {
      const other = { ...PACKET, message: { ...PACKET.message, ask: 'Нагадати в понеділок?' } };
      const thread = { ...PACKET, discussionId: 'a1b2c3d4-0000-4000-8000-000000000001' };

      expect(chatDeliveryKey(other)).not.toBe(chatDeliveryKey(PACKET));
      expect(chatDeliveryKey(thread)).not.toBe(chatDeliveryKey(PACKET));
    });

    it('a packet with a link and the same packet without one are different packets', () => {
      const withoutLink: typeof PACKET = {
        ...PACKET,
        message: { ...PACKET.message, link: undefined },
      };

      expect(chatDeliveryKey(withoutLink)).not.toBe(chatDeliveryKey(PACKET));
    });

    it('a different proposal in the packet makes a different packet', () => {
      const proposing = (id: string): typeof PACKET => ({
        ...PACKET,
        message: {
          ...PACKET.message,
          proposals: [{ pendingActionId: id, line: 'Закрити задачу' }],
        },
      });

      expect(chatDeliveryKey(proposing('p1'))).not.toBe(chatDeliveryKey(proposing('p2')));
    });

    it('does not coincide with the key of a run', () => {
      expect(chatDeliveryKey(PACKET).startsWith('chat:')).toBe(true);
      expect(runDeliveryKey('evt-1').startsWith('event:')).toBe(true);
    });
  });
});
