import { Injectable } from '@nestjs/common';
import { PendingAction } from '../generated/prisma/client';
import { canonicalNotionId } from '../notion/client/notion-id';
import { SemanticAdapter } from '../notion/semantics/semantic.adapter';
import { InvalidRequestError, parsedRequest } from '../platform/request/invalid-request';
import { Actor, RunActor } from '../runs/actor';
import { InvalidProposalError } from './approvals.error';
import { PendingActionRepository } from './contracts/pending-action.repository';
import { PreconditionEvaluator } from './preconditions/precondition.evaluator';
import { Proposal, ProposalRequest, proposalSchema, StagedProposal } from './proposal.schema';
import { validateProposal, writesOf } from './proposal.validity';
import {
  ProposalAbsentWire,
  ProposalDecisionResultWire,
  ProposalListWire,
  proposalStateOf,
  ProposalStateWire,
  proposalSummaryOf,
  stagedProposalOf,
} from './proposal.wire';

/**
 * The largest proposal the App accepts. The person reads a proposal before approving it, and the
 * display returns it whole. The limit keeps both finite (`INV-303`).
 */
export const MAX_PROPOSAL_CHARS = 20_000;

/** How many open proposals the list includes: the rest is `truncated`. */
export const OPEN_PROPOSALS_LIMIT = 10;

/**
 * Pending approval as a capability: proposals of autonomous runs and the person's decisions
 * about them.
 *
 * The boundary follows who acts. Only a run proposes: in the chat Claude itself writes, and a
 * proposal left unanswered there stays an Inbox item (`INV-015`). Only the person decides, by a
 * channel button or in the chat. A run neither approves nor rejects anything, not even one that
 * carries the person's words, and not even when its capability class contains approval.
 *
 * There is no withdrawal of a proposal by the system, and that is a decision, not an omission:
 * `contracts/canonical.yaml`, key `pending_action`.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly actions: PendingActionRepository,
    private readonly preconditions: PreconditionEvaluator,
    private readonly semantics: SemanticAdapter,
  ) {}

  /**
   * Checks a proposal against everything it must pass to be written, without writing anything.
   *
   * The check is here, not only at execution: otherwise a proposal that cannot be executed would
   * reach the person, who would spend a decision on something that is guaranteed not to happen.
   * So the same evaluator checks the preconditions, and the values are encoded the same way as at
   * execution, on a freshly read page (`docs/2-system.md` § “Approval-required writes”).
   */
  async check(actor: Actor, proposal: ProposalRequest): Promise<Proposal> {
    assertMayPropose(actor);

    // The label is a constant: no field of the request can be trusted before the schema check.
    const parsed = parsedRequest(proposalSchema, proposal, 'proposal');
    const validity = validateProposal(parsed.effects, parsed.preconditions);

    if (!validity.valid) {
      throw new InvalidProposalError(validity.defects);
    }

    if (JSON.stringify(parsed).length > MAX_PROPOSAL_CHARS) {
      throw new InvalidRequestError(
        `proposal: longer than ${MAX_PROPOSAL_CHARS} characters — too long for a person to review`,
      );
    }

    const verdict = await this.preconditions.evaluate(validity.subject, parsed.preconditions);
    if (verdict.outcome !== 'holds') {
      throw new InvalidRequestError(
        `proposal: precondition ${verdict.failed.kind} ${verdict.outcome} — ${verdict.detail}`,
      );
    }

    this.semantics.assertWritable(verdict.subject, writesOf(parsed.effects));

    return parsed;
  }

  /**
   * Records a proposal that `check` has already accepted. A run's staged writes check it twice,
   * when the model made it and before applying, so a third check at the write itself would add
   * nothing except a read of Notion.
   */
  async record(actor: Actor, proposal: Proposal): Promise<PendingAction> {
    assertMayPropose(actor);

    return this.actions.propose(proposal, actor.runId);
  }

  /**
   * Returns the open proposal for the same change, if one already exists: a new proposal with the
   * same effects would be that same proposal.
   */
  async openLike(proposal: Proposal): Promise<ProposalStateWire | null> {
    const row = await this.actions.openLike(proposal);

    return row && proposalStateOf(row);
  }

  /**
   * Returns the state of a proposal: a store row, a proposal this run wrote (`staged`) or its
   * absence.
   */
  async state(
    id: string,
    staged: readonly StagedProposal[],
  ): Promise<ProposalStateWire | ProposalAbsentWire> {
    const written = staged.find((proposal) => proposal.provisionalId === id);
    if (written) {
      return stagedProposalOf(written);
    }

    const row = await this.actions.find(id);

    return row ? proposalStateOf(row) : { pending_action_id: id, found: false };
  }

  /**
   * Returns the proposals awaiting the person's decision, so that a conversation step knows what
   * to ask about. `state` returns the content of each; this call returns only what, where and
   * since when.
   */
  async listOpen(): Promise<ProposalListWire> {
    const rows = await this.actions.proposed(OPEN_PROPOSALS_LIMIT + 1);

    return {
      proposals: rows.slice(0, OPEN_PROPOSALS_LIMIT).map(proposalSummaryOf),
      ...(rows.length > OPEN_PROPOSALS_LIMIT ? { truncated: true as const } : {}),
    };
  }

  /**
   * Accepts the person's decision, approve or reject. The executor executes what is approved, not
   * this call, which only records the decision (`INV-023`).
   */
  async decide(actor: Actor, id: string, decision: Decision): Promise<ProposalDecisionResultWire> {
    const accepted =
      decision === 'approve' ? await this.approve(actor, id) : await this.reject(actor, id);

    return { pending_action_id: id, decision, accepted };
  }

  /**
   * Checks whether an open proposal waits on the thread. That is one of the signs of a thread
   * the system manages (`contracts/canonical.yaml`, key `system_discussion`).
   */
  hasOpenFor(discussionId: string): Promise<boolean> {
    return this.actions.hasOpenOn(canonicalNotionId(discussionId));
  }

  /**
   * Requests a recheck after the person changed a page: the executor will check the preconditions
   * of proposals awaiting a decision on it, and a broken precondition will close its proposal
   * (ADR 0044). The method only makes the request, because event intake does not wait for Notion.
   */
  recheckOn(notionPageId: string): Promise<void> {
    return this.actions.requestRecheck(canonicalNotionId(notionPageId));
  }

  /** Checks whether a proposal that changes the page awaits a decision or execution. */
  hasOpenOnPage(notionPageId: string): Promise<boolean> {
    return this.actions.hasOpenOnPage(canonicalNotionId(notionPageId));
  }

  /**
   * Returns the threads on which an open proposal waits. They are part of the threads the system
   * manages.
   */
  openDiscussions(): Promise<string[]> {
    return this.actions.openDiscussions();
  }

  /**
   * Checks whether the proposal still awaits the person's decision. An approved proposal no
   * longer waits. Only execution remains, and a button on it would decide nothing.
   */
  async awaitsDecision(id: string): Promise<boolean> {
    return (await this.actions.find(id))?.status === 'proposed';
  }

  /**
   * Returns the pages and threads of the recorded proposals: what the packet with their buttons is
   * about.
   */
  async subjectsOf(
    ids: readonly string[],
  ): Promise<{ readonly pages: string[]; readonly discussions: string[] }> {
    const rows = await this.actions.findMany(ids.map(canonicalNotionId));

    return {
      pages: rows.map((row) => row.notionPageId),
      discussions: rows.flatMap((row) => (row.discussionId === null ? [] : [row.discussionId])),
    };
  }

  /**
   * Counts the proposals that await the person's decision besides the named ones: the rest, which
   * the packet does not show.
   */
  waitingBesides(ids: readonly string[]): Promise<number> {
    return this.actions.countProposed(ids.map(canonicalNotionId));
  }

  /** Checks whether the proposal expired: the Daily Control showed it, and it got no decision. */
  async lapsed(id: string): Promise<boolean> {
    return (await this.actions.find(id))?.status === 'expired';
  }

  /**
   * Expires the proposals that the delivered Daily Control packets showed and the person passed
   * by. Each of those still awaiting a decision expires (ADR 0039), and the fate publication
   * reports in the message that it expired (ADR 0043). An approved, decided or already expired
   * proposal is not touched.
   */
  async lapseShown(ids: readonly string[]): Promise<number> {
    return (await this.actions.lapse(ids)).length;
  }

  /**
   * Approves a proposal. `false` means it no longer awaits a decision: approving again is harmless
   * and does nothing. The decision is only recorded: the fate publication, not this call, writes
   * the trail in the thread and rewrites the message (ADR 0043). Otherwise the answer to the
   * button press would wait for the network (`INV-023`).
   */
  async approve(actor: Actor, id: string): Promise<boolean> {
    this.assertMayDecide(actor, 'approve');

    return this.actions.approve(id);
  }

  async reject(actor: Actor, id: string): Promise<boolean> {
    this.assertMayDecide(actor, 'reject');

    return this.actions.reject(id);
  }

  /**
   * The person decides where they see what will be executed: next to a button or in the chat.
   * A run never decides, and neither does a run that carries the person's words. A “yes” in a
   * thread is not a decision but a proposal the run made: otherwise the proposal would be guarded
   * against the very run that made it (`contracts/canonical.yaml`, key `pending_action`).
   */
  private assertMayDecide(actor: Actor, decision: Decision): void {
    if (actor.kind === 'run') {
      throw new InvalidRequestError(
        `${decision}: only the person decides on a proposal, with a channel button or in chat; a run never does`,
      );
    }
  }
}

/** The person's decision about a proposal. */
type Decision = 'approve' | 'reject';

/**
 * Only a run proposes. The chat makes no proposals: there Claude itself writes, and what is left
 * unanswered stays an Inbox item (`INV-015`). A channel button makes none either: with it the
 * person decides on a proposal that already exists.
 */
function assertMayPropose(actor: Actor): asserts actor is RunActor {
  switch (actor.kind) {
    case 'run':
      return;

    case 'chat':
      throw new InvalidRequestError(
        'proposal: a proposal made in chat stays an Inbox item (INV-015); pending_actions holds proposals of autonomous runs',
      );

    case 'channel_button':
      throw new InvalidRequestError(
        'proposal: a channel button decides on a proposal and makes none; pending_actions holds proposals of autonomous runs',
      );
  }
}
