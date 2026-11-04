import { Actor, CHANNEL_BUTTON, CHAT, onPersonsRequest, personSpeaks } from './actor';
import { RunProvenance } from './provenance';

describe("whether a step is the person's request", () => {
  it('chat and a channel button always count, because the person speaks to the system themselves', () => {
    const people: Actor[] = [CHAT, CHANNEL_BUTTON];
    const expected: boolean[] = [true, true];

    expect(people.map(onPersonsRequest)).toEqual(expected);
  });

  it('an App run gets its answer from the same classifier as the run budget', () => {
    const snoozed: Actor = {
      kind: 'run',
      runId: 'run-1',
      mode: 'scheduled_recheck',
      provenance: { origin: 'scheduled_check', reasonCode: 'user_snooze' },
      startedAt: new Date('2026-09-28T09:00:00.000Z'),
    };
    const ownRecheck: Actor = {
      kind: 'run',
      runId: 'run-2',
      mode: 'scheduled_recheck',
      provenance: { origin: 'scheduled_check', reasonCode: 'safety_recheck' },
      startedAt: new Date('2026-09-28T09:00:00.000Z'),
    };
    const noticed: Actor = {
      kind: 'run',
      runId: 'run-3',
      mode: 'event_evaluation',
      provenance: { origin: 'evaluation_window' },
      startedAt: new Date('2026-09-28T09:00:00.000Z'),
    };
    // The operator who launched the gate by hand is the person who asked, so neither the budget
    // nor quiet hours stand between them and the launch.
    const gate: Actor = {
      kind: 'run',
      runId: 'run-4',
      mode: 'event_evaluation',
      provenance: { origin: 'operator' },
      startedAt: new Date('2026-09-28T09:00:00.000Z'),
    };

    const expected: boolean[] = [true, false, false, true];

    expect([snoozed, ownRecheck, noticed, gate].map(onPersonsRequest)).toEqual(expected);
  });
});

/**
 * This is narrower than “asked”: an exempt run on the person's schedule or at a time the person
 * named does not carry the person's words and cannot decide for the person.
 */
describe('whether the person speaks for themselves in this step', () => {
  interface Step {
    readonly step: string;
    readonly actor: Actor;
    readonly speaks: boolean;
  }

  const run = (provenance: RunProvenance): Actor => ({
    kind: 'run',
    runId: 'run-1',
    mode: 'event_evaluation',
    provenance,
    startedAt: new Date('2026-09-28T09:00:00.000Z'),
  });

  const steps: Step[] = [
    { step: 'chat', actor: CHAT, speaks: true },
    { step: 'channel button', actor: CHANNEL_BUTTON, speaks: true },
    { step: 'channel reply', actor: run({ origin: 'channel_inbound' }), speaks: true },
    {
      step: 'thread reply',
      actor: run({ origin: 'managed_discussion_reply' }),
      speaks: true,
    },
    {
      step: "review on the person's schedule",
      actor: run({ origin: 'review_schedule' }),
      speaks: false,
    },
    {
      step: 'snooze that fired',
      actor: run({ origin: 'scheduled_check', reasonCode: 'user_snooze' }),
      speaks: false,
    },
    { step: 'change in Notion', actor: run({ origin: 'evaluation_window' }), speaks: false },
    { step: 'operator launch', actor: run({ origin: 'operator' }), speaks: false },
  ];

  it.each(steps)('$step → $speaks', ({ actor, speaks }) => {
    expect(personSpeaks(actor)).toBe(speaks);
  });
});
