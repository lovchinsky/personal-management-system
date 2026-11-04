import { PROPOSAL_ID } from '../../../../test/fixtures/telegram';
import { ACTION_KINDS } from '../../../delivery/port/channel.port';
import { textsOf } from '../../../texts/texts';
import { ChannelIntent } from '../channel-intent';
import { IntentOutcome } from '../intent.router';
import { Acknowledgement, acknowledgementOf, TelegramInbound } from './telegram.inbound';

describe('the intent from an update', () => {
  const inbound = new TelegramInbound();

  const callback = (data: string): unknown => ({
    update_id: 1,
    callback_query: { id: 'cb-1', data, message: { message_id: 7, chat: { id: 42 } } },
  });

  it.each([...ACTION_KINDS])('button %s produces an intent and an id', (kind) => {
    const expected: ChannelIntent = { kind, pendingActionId: PROPOSAL_ID };

    expect(inbound.parse(callback(`${kind}:${PROPOSAL_ID}`))).toEqual(expected);
  });

  /** Proposal ids are uuids; a truncated or forged string is not a button. */
  it('a button with an id that is not a uuid is not accepted', () => {
    expect(inbound.parse(callback('approve:pa-1'))).toBeNull();
  });

  it('an unknown intent is not accepted', () => {
    expect(inbound.parse(callback(`archive:${PROPOSAL_ID}`))).toBeNull();
  });

  it('a button without an id is not accepted', () => {
    expect(inbound.parse(callback('approve:'))).toBeNull();
  });

  /**
   * The channel accepts nothing new from the person, so text with no tie to a system message is
   * `unsolicited`.
   */
  it('text with no tie to a system message is `unsolicited` and has no content', () => {
    const expected: ChannelIntent = { kind: 'unsolicited' };

    expect(
      inbound.parse({
        update_id: 2,
        message: { message_id: 8, chat: { id: 42 }, text: '  ідея  ', date: 1_791_279_000 },
      }),
    ).toEqual(expected);
  });

  /**
   * The parser does not know whether the message was the system's: it only identifies what was
   * replied to.
   */
  it('text sent as a reply to a message is a `reply` with that message id', () => {
    const expected: ChannelIntent = {
      kind: 'reply',
      text: 'відклади до понеділка',
      channel: 'telegram',
      eventId: 'telegram:4',
      repliedTo: '31',
    };

    expect(
      inbound.parse({
        update_id: 4,
        message: {
          message_id: 9,
          chat: { id: 42 },
          text: 'відклади до понеділка',
          reply_to_message: { message_id: 31 },
        },
      }),
    ).toEqual(expected);
  });

  it('empty text is not an intent', () => {
    expect(
      inbound.parse({ update_id: 3, message: { message_id: 9, chat: { id: 42 }, text: '   ' } }),
    ).toBeNull();
  });

  it('an update of an unfamiliar shape is not accepted', () => {
    expect(inbound.parse({ nothing: true })).toBeNull();
  });
});

describe('the answer to a press', () => {
  interface Case {
    readonly outcome: IntentOutcome;
    readonly ack: Acknowledgement;
  }

  const cases: Case[] = [
    { outcome: { kind: 'decided', decision: 'approve' }, ack: { text: 'Схвалено', alert: false } },
    { outcome: { kind: 'decided', decision: 'reject' }, ack: { text: 'Відхилено', alert: false } },
    {
      outcome: { kind: 'not_awaiting' },
      ack: { text: 'Пропозиція вже не чекає рішення', alert: false },
    },
    {
      outcome: { kind: 'expired' },
      ack: {
        text: 'Ця пропозиція вже застаріла. Якщо зміна ще потрібна, скажи мені про це в чаті Claude',
        alert: true,
      },
    },
    { outcome: { kind: 'dismissed' }, ack: { text: 'Гаразд', alert: false } },
    {
      outcome: { kind: 'needs_time' },
      ack: {
        text: 'До коли відкласти? Напиши відповіддю на це повідомлення',
        alert: true,
      },
    },
    { outcome: { kind: 'replied' }, ack: { text: 'Прийнято', alert: false } },
    {
      outcome: { kind: 'unconsumed', reason: 'no dialogue' },
      ack: { text: 'Це не відповідь на моє повідомлення', alert: false },
    },
    {
      outcome: { kind: 'not_recorded' },
      ack: {
        text: 'Notion зараз недоступний, тож твою відповідь не записано. Надішли її трохи пізніше',
        alert: true,
      },
    },
  ];

  it.each(cases)('$outcome.kind → “$ack.text”', ({ outcome, ack }) => {
    expect(acknowledgementOf(outcome, textsOf('uk').telegram.answers)).toEqual(ack);
  });
});
