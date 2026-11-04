import { renderMessage } from '../../src/delivery/channels/telegram/telegram.renderer';
import { outboundMessageSchema } from '../../src/delivery/port/channel.port';
import type { TelegramTexts } from '../../src/texts/texts';
import type { Notice } from './m6-evidence';

/**
 * Measures the length of a packet in the channel, as Telegram renders it with the same texts the
 * App uses to speak. A packet the channel cannot parse has length 0: the person sees that packet
 * in the artifact.
 */
export function packetLength(notice: Notice, texts: TelegramTexts): number {
  const message = outboundMessageSchema.safeParse(notice);

  return message.success ? renderMessage(message.data, texts).length : 0;
}
