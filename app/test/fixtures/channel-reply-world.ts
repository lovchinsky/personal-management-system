import { Test } from '@nestjs/testing';
import { AttentionService } from '../../src/attention/attention.service';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { ChannelIntent } from '../../src/intake/channel/channel-intent';
import { ChannelReply } from '../../src/intake/channel/channel-reply';
import { EvaluationWindowRepository } from '../../src/intake/notion/evaluation-window.repository';
import { ReceiptHandle } from '../../src/intake/receipts/webhook-receipts';

export const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
export const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
export const THREAD_PAGE = '3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e';
export const SENT_AT = new Date('2026-10-06T09:30:00.000Z');

/** The person's reply to a system message that points to a thread. */
export const REPLY: Extract<ChannelIntent, { kind: 'reply' }> = {
  kind: 'reply',
  repliedTo: '31',
  text: 'відклади до понеділка',
  channel: 'telegram',
  eventId: 'telegram:17',
  sentAt: SENT_AT,
};

/** What happened, in the order it happened. The order is part of the claim. */
interface Log {
  readonly steps: string[];
  readonly recorded: string[];
  readonly absorbed: Parameters<EvaluationWindowRepository['absorb']>[0][];
  readonly quoted: [string, string, string][];
}

interface Setting {
  /**
   * The thread the replied-to message points to. `null` means the message is unknown or is not
   * about a thread.
   */
  readonly thread?: string | null;
  /** Notion does not accept the comment, so the words are not recorded. */
  readonly quoteFails?: boolean;
  /** The refusal Notion rejects the comment with. What the person hears depends on it. */
  readonly quoteRefusal?: Error;
}

/**
 * Builds the reply consumer over fakes of the thread, Notion and the evaluation window. What
 * happened is in the log.
 */
export async function replyOver(setting: Setting = {}): Promise<{
  reply: ChannelReply;
  log: Log;
  receipt: (pageId?: string) => ReceiptHandle;
}> {
  const log: Log = { steps: [], recorded: [], absorbed: [], quoted: [] };

  const attention: Pick<AttentionService, 'quote'> = {
    quote: (discussionId, channel, words) => {
      log.steps.push('quote');
      log.quoted.push([discussionId, channel, words]);

      if (setting.quoteRefusal) return Promise.reject(setting.quoteRefusal);

      return setting.quoteFails
        ? Promise.reject(new Error('Notion is down'))
        : Promise.resolve(THREAD_PAGE);
    },
  };
  const delivery: Pick<DeliveryService, 'threadOf'> = {
    threadOf: () => Promise.resolve(setting.thread ?? null),
  };
  const windows: Pick<EvaluationWindowRepository, 'absorb'> = {
    absorb: (event) => {
      log.steps.push('window');
      log.absorbed.push(event);

      return Promise.resolve('window-1');
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ChannelReply,
      { provide: AttentionService, useValue: attention },
      { provide: DeliveryService, useValue: delivery },
      { provide: EvaluationWindowRepository, useValue: windows },
    ],
  }).compile();

  const receipt = (pageId?: string): ReceiptHandle => ({
    pageId: pageId ?? null,
    recordPage: (page) => {
      log.steps.push('record page');
      log.recorded.push(page);

      return Promise.resolve();
    },
  });

  return { reply: moduleRef.get(ChannelReply), log, receipt };
}
