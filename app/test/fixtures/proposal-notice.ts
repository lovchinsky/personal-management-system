import { PROPOSAL_NOTICE, ProposalFate, ProposalNotice } from '../../src/approvals/proposal-notice';

/** A notice port that only records what it was told, in the order it was told. */
export class RecordingNotice implements ProposalNotice {
  readonly told: [string, ProposalFate][] = [];

  settled(pendingActionId: string, fate: ProposalFate): Promise<void> {
    this.told.push([pendingActionId, fate]);

    return Promise.resolve();
  }
}

/** Port provider for tests that need no notices. */
export const NOTICE_PROVIDER = { provide: PROPOSAL_NOTICE, useValue: new RecordingNotice() };
