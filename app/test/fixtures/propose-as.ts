import { ApprovalsService } from '../../src/approvals/approvals.service';
import { ProposalRequest } from '../../src/approvals/proposal.schema';
import { PendingAction } from '../../src/generated/prisma/client';
import { Actor } from '../../src/runs/actor';

/** Makes a proposal as a run handles it: check first, then record. */
export async function proposeAs(
  approvals: Pick<ApprovalsService, 'check' | 'record'>,
  actor: Actor,
  request: ProposalRequest,
): Promise<PendingAction> {
  return approvals.record(actor, await approvals.check(actor, request));
}
