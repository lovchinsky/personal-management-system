import { Test } from '@nestjs/testing';
import { FRESH_RECEIPT, PROPOSAL_ID } from '../../../test/fixtures/telegram';
import { ApprovalsService } from '../../approvals/approvals.service';
import { Actor, CHANNEL_BUTTON } from '../../runs/actor';
import { ReceiptHandle, Settlement } from '../receipts/webhook-receipts';
import { ChannelIntent } from './channel-intent';
import { ChannelReply, ReplyOutcome } from './channel-reply';
import { IntentOutcome, IntentRouter, settlementOf } from './intent.router';

interface Routing {
  readonly router: IntentRouter;
  /** Decisions that reached approvals: who decided, what and about which proposal. */
  readonly decisions: [Actor, string, string][];
  /** Replies that reached the channel consumer, and the receipt they travel in. */
  readonly texts: [string, ReceiptHandle][];
}

/**
 * Builds a router over approvals that only remember the decision. `awaiting` says whether the
 * proposal awaits a decision, and `lapsed` says whether it expired. What the service answers
 * depends on both.
 */
async function routerOver(awaiting = true, lapsed = false): Promise<Routing> {
  const decisions: [Actor, string, string][] = [];
  const approvals: Pick<ApprovalsService, 'approve' | 'reject' | 'lapsed'> = {
    lapsed: () => Promise.resolve(lapsed),
    approve: (actor, id) => {
      decisions.push([actor, 'approve', id]);

      return Promise.resolve(awaiting);
    },
    reject: (actor, id) => {
      decisions.push([actor, 'reject', id]);

      return Promise.resolve(awaiting);
    },
  };

  const texts: [string, ReceiptHandle][] = [];
  const replies: Pick<ChannelReply, 'reply'> = {
    reply: (intent, receipt) => {
      texts.push([intent.text, receipt]);

      return Promise.resolve<ReplyOutcome>({ kind: 'replied' });
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      IntentRouter,
      { provide: ApprovalsService, useValue: approvals },
      { provide: ChannelReply, useValue: replies },
    ],
  }).compile();

  return { router: moduleRef.get(IntentRouter), decisions, texts };
}

describe('the channel intent router', () => {
  it('sends a decision by button to approvals on behalf of the person at the button', async () => {
    const { router, decisions } = await routerOver();

    const approved = await router.route(
      { kind: 'approve', pendingActionId: PROPOSAL_ID },
      FRESH_RECEIPT,
    );
    const rejected = await router.route(
      { kind: 'reject', pendingActionId: PROPOSAL_ID },
      FRESH_RECEIPT,
    );

    const expected: IntentOutcome[] = [
      { kind: 'decided', decision: 'approve' },
      { kind: 'decided', decision: 'reject' },
    ];
    const recorded: [Actor, string, string][] = [
      [CHANNEL_BUTTON, 'approve', PROPOSAL_ID],
      [CHANNEL_BUTTON, 'reject', PROPOSAL_ID],
    ];

    expect([approved, rejected]).toEqual(expected);
    expect(decisions).toEqual(recorded);
  });

  it('names a proposal that is no longer awaiting a decision as `not_awaiting`', async () => {
    const { router } = await routerOver(false);
    const expected: IntentOutcome = { kind: 'not_awaiting' };

    await expect(
      router.route({ kind: 'approve', pendingActionId: PROPOSAL_ID }, FRESH_RECEIPT),
    ).resolves.toEqual(expected);
  });

  /** The person must recognize an expired proposal as expired, not as “already decided”. */
  it('names an expired proposal as `expired`', async () => {
    const { router } = await routerOver(false, true);
    const expected: IntentOutcome = { kind: 'expired' };

    await expect(
      router.route({ kind: 'reject', pendingActionId: PROPOSAL_ID }, FRESH_RECEIPT),
    ).resolves.toEqual(expected);
  });

  /**
   * Dismissing a message is not a decision about the proposal, and a snooze without a time is not
   * a snooze, so neither of the two reaches approvals.
   */
  it('decides nothing for the person on `dismiss` and `snooze` by button', async () => {
    const { router, decisions } = await routerOver();

    const dismissed = await router.route(
      { kind: 'dismiss', pendingActionId: PROPOSAL_ID },
      FRESH_RECEIPT,
    );
    const snoozed = await router.route(
      { kind: 'snooze', pendingActionId: PROPOSAL_ID },
      FRESH_RECEIPT,
    );

    const expected: IntentOutcome[] = [{ kind: 'dismissed' }, { kind: 'needs_time' }];

    expect([dismissed, snoozed]).toEqual(expected);
    expect(decisions).toHaveLength(0);
  });

  /**
   * A reply is the person's words, and the channel consumer owns them, so the router only passes
   * them on together with the receipt in which the work proceeds.
   */
  it('sends a reply to the channel consumer with the receipt, not to approvals', async () => {
    const { router, decisions, texts } = await routerOver();
    const intent: ChannelIntent = {
      kind: 'reply',
      text: 'так',
      repliedTo: '7',
      channel: 'telegram',
      eventId: 'telegram:5',
    };

    const expected: IntentOutcome = { kind: 'replied' };

    await expect(router.route(intent, FRESH_RECEIPT)).resolves.toEqual(expected);
    expect(texts).toEqual([['так', FRESH_RECEIPT]]);
    expect(decisions).toHaveLength(0);
  });

  /**
   * The channel serves a dialogue the system started, so it accepts nothing new from the person.
   */
  it('does not accept text that does not answer a system message', async () => {
    const { router, texts } = await routerOver();

    const outcome = await router.route({ kind: 'unsolicited' }, FRESH_RECEIPT);

    expect(outcome).toMatchObject({ kind: 'unconsumed' });
    expect(texts).toHaveLength(0);
  });
});

describe('the outcome of an intent for the receipt', () => {
  it('an intent with nothing to attach to is `rejected` with a reason and the rest are `processed`', () => {
    const unconsumed: IntentOutcome = { kind: 'unconsumed', reason: 'no dialogue' };
    const replied: IntentOutcome = { kind: 'replied' };

    expect([settlementOf(unconsumed), settlementOf(replied)]).toEqual([
      { status: 'rejected', reason: 'no dialogue' },
      { status: 'processed', value: replied },
    ]);
  });

  /**
   * The person has already been told to send the words later. A late redelivery of the same
   * update would produce a second reply to the same words, so the receipt is rejected rather than
   * left to the provider to redeliver (ADR 0045).
   */
  it('words that were not recorded are `rejected` with a reason instead of being left for redelivery', () => {
    const notRecorded: IntentOutcome = { kind: 'not_recorded' };
    const expected: Settlement<IntentOutcome> = {
      status: 'rejected',
      reason: 'Notion is unavailable: the reply was not recorded',
    };

    expect(settlementOf(notRecorded)).toEqual(expected);
  });
});
