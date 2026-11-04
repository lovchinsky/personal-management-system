import { NotificationOutbox } from '../../src/generated/prisma/client';

/** A delivery queue row that has just joined the queue: nothing has happened to it yet. */
export const QUEUED: NotificationOutbox = {
  id: 'row-1',
  idempotencyKey: 'nudge-1',
  discussionId: null,
  channel: 'telegram',
  externalId: null,
  payload: {},
  status: 'pending',
  attemptCount: 0,
  nextAttemptAt: null,
  lockedUntil: null,
  quietHoursExempt: false,
  sentAt: null,
  lastError: null,
  createdAt: new Date(0),
};
