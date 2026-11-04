import { MAX_PROPOSAL_CHARS } from '../../../approvals/approvals.service';
import {
  LISTED_EFFECTS,
  proposalDecisionWireSchema,
  proposalListWireSchema,
  proposalQueryWireSchema,
  proposalRequestOf,
  ProposalWire,
  proposalWireSchema,
} from '../../../approvals/proposal.wire';
import { AppTool, defineTool, ToolContext, writeAnswer, WRITES } from './app-tool';

/**
 * Writes a proposal. It gets a temporary id, which a delivery button of the same run can refer
 * to, and gets the real id when the writes are applied.
 */
async function propose(context: ToolContext, input: ProposalWire): Promise<object> {
  const { write: proposal, ref } = await context.session.writes.submit(
    'proposal',
    proposalRequestOf(input),
  );
  const same = await context.approvals.openLike(proposal);

  return writeAnswer(context, {
    pending_action_id: ref,
    ...(same
      ? { same_open_proposal: { pending_action_id: same.pending_action_id, status: same.status } }
      : {}),
  });
}

/**
 * The largest row of the list of open proposals: id, thread, time and the named effects, each
 * with its longest value. The number of rows in the list is limited (`OPEN_PROPOSALS_LIMIT`), so
 * the response bound is finite by construction.
 */
const LISTED_BOUND_CHARS = 12_000;

export const APPROVAL_TOOLS: readonly AppTool[] = [
  defineTool({
    name: 'create_pending_action',
    capability: 'approval_propose',
    bound: 2_000,
    description:
      'Propose an approval-required change of Notion properties as an immutable contract. ' +
      'Each effect names a page, a property and the canonical value to write: text, an ' +
      'option by its canonical name, a date, links or clear. Every effect needs a ' +
      'precondition that observes it: property_equals for an option write or clear, ' +
      'property_empty for a value written into an empty property, property_reads_as to change ' +
      'a filled property (it names the value the property reads as now, in canonical form — ' +
      'a different value than the one written). Preconditions are checked ' +
      'and values encoded against the live page at once: a proposal that could not be ' +
      'executed is refused with the reason. The system writes the change after the person ' +
      "approves it. Returns a pending_action_id usable in this run's notification buttons. " +
      'Only an autonomous run proposes: a chat never does. ' +
      WRITES,
    inputSchema: proposalWireSchema,
    handle: propose,
  }),
  defineTool({
    name: 'get_pending_action',
    capability: 'approval_read',
    // A proposal is bounded at write time, and showing it adds only the status and the times.
    bound: MAX_PROPOSAL_CHARS + 2_000,
    description:
      'Status and content of a proposal by pending_action_id, including ones staged by this run.',
    inputSchema: proposalQueryWireSchema,
    handle: (context, input) =>
      context.approvals.state(
        input.pending_action_id,
        context.session.writes
          .pending('proposal')
          .map(({ ref, write }) => ({ provisionalId: ref, proposal: write })),
      ),
  }),
  defineTool({
    name: 'list_pending_actions',
    capability: 'approval_read',
    bound: LISTED_BOUND_CHARS,
    description:
      'Proposals that still wait for the person, oldest first: id, thread, when, and the pages ' +
      `and properties they would change (the first ${LISTED_EFFECTS}). The content the person ` +
      'approves is in get_pending_action — read it and show it before asking for a decision. ' +
      'truncated: true means more proposals are open than listed.',
    inputSchema: proposalListWireSchema,
    handle: (context) => context.approvals.listOpen(),
  }),
  defineTool({
    name: 'decide_pending_action',
    capability: 'approval_decide',
    bound: 1_000,
    description:
      'Record the decision of the person on a proposal: approve or reject. Call it only after ' +
      'the person has seen what will be written (get_pending_action) and said so in this ' +
      'conversation. The decision is recorded at once; the system writes the approved change ' +
      'afterwards, and re-checks that the page is still as it was shown. accepted: false means ' +
      'the proposal no longer awaits a decision.',
    inputSchema: proposalDecisionWireSchema,
    handle: (context, input) =>
      context.approvals.decide(context.session.actor, input.pending_action_id, input.decision),
  }),
];
