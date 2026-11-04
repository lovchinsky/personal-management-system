import { InvalidRequestError } from '../platform/request/invalid-request';
import { describeDefect, ProposalDefect } from './proposal.validity';

/**
 * A proposal that cannot be executed.
 *
 * It is an error made by whoever composes the proposal, not a runtime state. `validateProposal`
 * computes the list of defects. It is one function for both clauses of the validity rule, and
 * execution reruns that same function: otherwise the clauses diverge, and each half silently
 * relies on the other.
 */
export class InvalidProposalError extends InvalidRequestError {
  constructor(readonly defects: readonly ProposalDefect[]) {
    super(`proposal ${defects.map(describeDefect).join('; ')}`);
  }
}
