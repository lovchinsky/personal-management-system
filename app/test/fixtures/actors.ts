import { RunActor } from '../../src/runs/actor';

/** The number and start time of the run in a test. No test using these fixtures asks about them. */
const A_RUN = {
  kind: 'run',
  runId: 'run-1',
  startedAt: new Date('2026-09-29T09:00:00.000Z'),
} as const;

/** A change in Notion that nobody asked for: an autonomous run. */
export const NOTICED: RunActor = {
  ...A_RUN,
  mode: 'event_evaluation',
  provenance: { origin: 'evaluation_window' },
};

/**
 * Processing an Inbox item: a `dialogue` run that the person started by putting the item in the
 * Inbox.
 */
export const CAPTURING: RunActor = {
  ...A_RUN,
  mode: 'dialogue',
  provenance: { origin: 'inbox_capture' },
};
