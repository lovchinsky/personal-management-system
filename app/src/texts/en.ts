import type { ReasonRequestedByPerson } from '../runs/provenance';
import type { ReviewMode } from '../runs/trigger-envelope';
import type { Texts } from './texts';

const PLURAL = new Intl.PluralRules('en');

/** Noun form for a number: `one` — 1; `other` — everything else. */
function counted(count: number, forms: { one: string; other: string }): string {
  return `${count} ${PLURAL.select(count) === 'one' ? forms.one : forms.other}`;
}

const REVIEWS: Readonly<
  Record<ReviewMode, { readonly name: string; readonly scope: string; readonly request: string }>
> = {
  daily_control: {
    name: 'daily review',
    scope: "The day's commitments, tasks ready to start and open proposals",
    request: 'do a daily review',
  },
  weekly_control_review: {
    name: 'weekly review',
    scope: 'Stale Inbox items, waiting-for items and risks',
    request: 'do a weekly review',
  },
  strategic_review: {
    name: 'strategic review',
    scope: 'Objectives, their Key Results and resource conflicts',
    request: 'do a strategic review',
  },
  deep_review: {
    name: 'deep review',
    scope: 'Identities, their principles and Areas of Focus',
    request: 'do a deep review',
  },
};

/** English addresses the person without grammatical gender: one form for every value. */
const WAKES: Readonly<
  Record<
    ReasonRequestedByPerson,
    { readonly noticed: (moment: string) => string; readonly whyItMatters: string }
  >
> = {
  user_snooze: {
    noticed: (moment) => `The reminder you asked for on ${moment} did not go off.`,
    whyItMatters:
      'At the time you named, the matter did not come back to you and has had no attention.',
  },
  deadline_followup: {
    noticed: (moment) => `The deadline check set for ${moment} did not take place.`,
    whyItMatters:
      'It is your deadline, and there was no check on whether the matter is on track for it.',
  },
};

export const en = {
  language: 'en',
  notices: {
    breaker: {
      noticed: (failures) =>
        `Autonomous runs have stopped: ${counted(failures, { one: 'failure', other: 'failures' })} in a row.`,
      whyItMatters:
        'The run path itself seems broken, and the next run will fail too. What you ask for still ' +
        'goes ahead as usual; autonomous runs resume after the first successful one.',
      reason: (text) => `Latest cause: ${text}`,
      ask: 'Will you look into why they fail?',
    },
    connection: {
      noticed: (client, host) =>
        `“${client}” (${host}) has connected to Personal Management System.`,
      whyItMatters:
        "It can read the state of your system and act on your behalf in chat. If this wasn't you, " +
        'someone knows the owner passphrase: change it and revoke the tokens.',
      ask: 'Was this you?',
    },
    reviewFailure: {
      noticed: (mode, period) => `The ${REVIEWS[mode].name} for ${period} did not take place.`,
      whyItMatters: (mode) => `${REVIEWS[mode].scope} went unreviewed.`,
      reason: (text) => `Reason: ${text}`,
      ask: (mode) => `If you need it, ask me in a Claude chat: “${REVIEWS[mode].request}”.`,
      quarter: (quarter, year) => `Q${quarter} ${year}`,
    },
    notionWait: {
      waiting: {
        noticed: 'Your reply arrived, but Notion is unavailable right now.',
        whyItMatters:
          'Without it I can see neither the matter nor your reply, so I cannot answer yet.',
        ask: 'Nothing to do: I will answer as soon as Notion is back.',
      },
      gaveUp: {
        noticed: 'Notion was unavailable for a day, and your message went unanswered.',
        whyItMatters:
          'I will not wait any longer, so without a new message the matter stays unanswered.',
        ask: 'Please write again, as a reply to this message.',
      },
    },
    wakeFailure: {
      noticed: (reason, moment) => WAKES[reason].noticed(moment),
      whyItMatters: (reason) => WAKES[reason].whyItMatters,
      ask: 'Have a look at the matter in Notion when you can: the system will not come back to it on its own.',
    },
  },
  comments: {
    labels: {
      channelReply: (channel) => `Reply from ${channel}`,
      proposalDecision: 'Your decision',
      proposalResult: 'Outcome of the change',
    },
    fields: {
      status: 'status',
      date: 'date',
      deadline: 'deadline',
    },
    proposal: {
      approved: (change) => `You approved: ${change}.`,
      rejected: (change) => `You rejected: ${change}.`,
      notWritten: (change, reason) => `The approved change was not written (${change}): ${reason}.`,
      reasons: {
        conflict: 'the page changed after the proposal',
        noAccess: 'the system has no access to the page',
        unavailable: 'Notion did not respond for a day',
        other: 'Notion did not accept the write',
      },
      cleared: 'empty',
      links: (count) => counted(count, { one: 'link', other: 'links' }),
    },
  },
  outcomes: {
    approved: 'Approved — in progress',
    rejected: 'Rejected',
    executed: 'Done',
    conflict: 'Not done: the page changed',
    failed: 'Not done: an error occurred',
    expired: 'Expired: no decision before the next review',
  },
  telegram: {
    openInNotion: 'Open in Notion',
    moreWaiting: (count) => `Still awaiting a decision: ${count}.`,
    buttons: {
      approve: '✓ Approve',
      reject: '✕ Reject',
      snooze: '⏱ Snooze',
      dismiss: '— Dismiss',
    },
    answers: {
      // “Approved”, not “executing”: execution is still ahead, and it may end in a conflict.
      approved: 'Approved',
      rejected: 'Rejected',
      notAwaiting: 'This proposal is no longer awaiting a decision',
      expired: 'This proposal has expired. If the change is still needed, tell me in a Claude chat',
      dismissed: 'OK',
      needsTime: 'Until when? Reply to this message to say',
      replied: 'Got it',
      unconsumed: 'This is not a reply to my message',
      notRecorded:
        'Notion is unavailable right now, so your reply was not recorded. Send it again a bit later',
      unreadable: 'The button could not be read',
    },
    nowhere:
      "These words won't land anywhere: here I only take replies to my messages about a specific matter. Write it in Notion or tell me in a Claude chat",
  },
  consent: {
    title: 'Personal Management System — access to App MCP',
    heading: 'Allow access?',
    client: 'Client',
    returnsTo: 'Returns to',
    resource: 'Resource',
    explanation:
      'The client will be able to read the App state and act on your behalf in chat: add and close Inbox items, schedule follow-ups, approve proposals.',
    passphrase: 'Owner passphrase',
    allow: 'Allow',
    deny: 'Deny',
    refused: 'Wrong passphrase',
    locked: (seconds) =>
      `Too many failed attempts. Try again in ${counted(seconds, { one: 'second', other: 'seconds' })}.`,
    errorTitle: 'Personal Management System — request refused',
    errorHeading: 'Request refused',
  },
} as const satisfies Texts;
