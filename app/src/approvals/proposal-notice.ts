/**
 * What a proposal became: the person's decision, the end of execution or expiry.
 *
 * `approved` and `rejected` are decisions; `executed`, `conflict` and `failed` are the ways an
 * approved proposal ended; `expired` means the person passed by a proposal that the Daily Control
 * showed (`contracts/canonical.yaml`, key `pending_action`).
 */
export type ProposalFate = 'approved' | 'rejected' | 'executed' | 'conflict' | 'failed' | 'expired';

/**
 * The port to the messages about a proposal. Delivery implements the port: it knows which
 * message in which channel showed the proposal, and appends to that message how the proposal
 * ended. Without an adapter the port is `AbsentProposalNotice`.
 *
 * The notice is cosmetic, not part of the decision: a message failure cancels neither the decision
 * nor the execution, so the adapter does not throw the failure (`INV-023`).
 */
export interface ProposalNotice {
  settled(pendingActionId: string, fate: ProposalFate): Promise<void>;
}

export const PROPOSAL_NOTICE = Symbol('ProposalNotice');

/**
 * The token under which the adapter plugs itself in from outside `approvals/`: the approvals
 * module does not import the adapter.
 */
export const PROPOSAL_NOTICE_ADAPTER = Symbol('ProposalNoticeAdapter');

/** Wiring without a channel that can edit a message: there is no one to speak. */
export class AbsentProposalNotice implements ProposalNotice {
  settled(): Promise<void> {
    return Promise.resolve();
  }
}
