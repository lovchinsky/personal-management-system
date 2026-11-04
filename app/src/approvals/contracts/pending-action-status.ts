import { PendingActionStatus } from '../../generated/prisma/enums';

/**
 * Non-terminal statuses of a proposal: it still awaits the person's decision or execution
 * (`contracts/canonical.yaml`, key `pending_action`).
 */
export const OPEN_STATUSES: readonly PendingActionStatus[] = ['proposed', 'approved'];

export function isOpenStatus(status: PendingActionStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
