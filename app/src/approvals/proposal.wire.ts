import { z } from 'zod';
import { PendingAction } from '../generated/prisma/client';
import { PendingActionStatus } from '../generated/prisma/enums';
import { CanonicalWrite, CanonicalWriteRequest } from '../notion/semantics/canonical-write';
import {
  Precondition,
  PreconditionRequest,
  preconditionsSchema,
} from './preconditions/precondition';
import { effectsSchema, Proposal, ProposalRequest, StagedProposal } from './proposal.schema';

const pageId = z.string().min(1);
const propertyId = z.string().min(1);

/**
 * The value an effect will write, under wire names. An option is given by its canonical name from
 * `get_schema_mapping`, not by an option id, because the binding translates the name.
 */
const valueWire = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('option'), option: z.string() }),
  z.strictObject({
    kind: z.literal('date'),
    start: z.string(),
    end: z.string().nullable().optional(),
  }),
  z.strictObject({ kind: z.literal('links'), page_ids: z.array(z.string()) }),
  z.strictObject({ kind: z.literal('clear') }),
]);

type ValueWire = z.infer<typeof valueWire>;

const effectWire = z.strictObject({
  kind: z.literal('property_write'),
  page_id: pageId,
  property_id: propertyId,
  value: valueWire,
});

const preconditionWire = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('page_exists'), page_id: pageId }),
  z.strictObject({
    kind: z.literal('property_equals'),
    page_id: pageId,
    property_id: propertyId,
    option_id: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('property_empty'), page_id: pageId, property_id: propertyId }),
  z.strictObject({
    kind: z.literal('property_reads_as'),
    page_id: pageId,
    property_id: propertyId,
    value: valueWire,
  }),
  z.strictObject({
    kind: z.literal('unchanged_since'),
    page_id: pageId,
    last_edited_time: z.string().min(1),
  }),
]);

type EffectWire = z.infer<typeof effectWire>;
type PreconditionWire = z.infer<typeof preconditionWire>;

/**
 * A proposal on the App MCP wire (`create_pending_action`): the same fields as in
 * `proposalSchema`, under wire names (`docs/2-system.md` § “App MCP”).
 *
 * Only the shape is defined here. The service checks validity, canonical ids and whether values are
 * admissible, using the same `proposalSchema` that checks any other input, because a second copy of
 * the rules would drift from the first.
 */
export const proposalWireSchema = z.strictObject({
  discussion_id: z.string().min(1).optional(),
  effects: z.array(effectWire),
  preconditions: z.array(preconditionWire),
});

export type ProposalWire = z.infer<typeof proposalWireSchema>;

/** Converts a proposal from the wire into the shape the service accepts. */
export function proposalRequestOf(wire: ProposalWire): ProposalRequest {
  return {
    discussionId: wire.discussion_id,
    effects: wire.effects.map((effect) => ({
      kind: effect.kind,
      pageId: effect.page_id,
      propertyId: effect.property_id,
      value: valueRequestOf(effect.value),
    })),
    preconditions: wire.preconditions.map(preconditionRequestOf),
  };
}

function valueRequestOf(wire: ValueWire): CanonicalWriteRequest {
  switch (wire.kind) {
    case 'links':
      return { kind: wire.kind, pageIds: wire.page_ids };

    case 'date':
      return { kind: wire.kind, start: wire.start, end: wire.end };

    default:
      return wire;
  }
}

function valueWireOf(value: CanonicalWrite): ValueWire {
  switch (value.kind) {
    case 'links':
      return { kind: value.kind, page_ids: [...value.pageIds] };

    case 'date':
      return { kind: value.kind, start: value.start, end: value.end };

    default:
      return value;
  }
}

function preconditionRequestOf(wire: PreconditionWire): PreconditionRequest {
  switch (wire.kind) {
    case 'page_exists':
      return { kind: wire.kind, pageId: wire.page_id };
    case 'property_equals':
      return {
        kind: wire.kind,
        pageId: wire.page_id,
        propertyId: wire.property_id,
        optionId: wire.option_id,
      };
    case 'property_empty':
      return { kind: wire.kind, pageId: wire.page_id, propertyId: wire.property_id };
    case 'property_reads_as':
      return {
        kind: wire.kind,
        pageId: wire.page_id,
        propertyId: wire.property_id,
        value: valueRequestOf(wire.value),
      };
    case 'unchanged_since':
      return { kind: wire.kind, pageId: wire.page_id, lastEditedTime: wire.last_edited_time };
  }
}

/** The proposal whose state to ask for (`get_pending_action`). */
export const proposalQueryWireSchema = z.strictObject({ pending_action_id: z.string().min(1) });

/** The person's decision on a proposal (`decide_pending_action`). */
export const proposalDecisionWireSchema = z.strictObject({
  pending_action_id: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
});

/**
 * The list of open proposals takes no parameters: a question with no fields is closed too
 * (`INV-090`).
 */
export const proposalListWireSchema = z.strictObject({});

/**
 * How many effects a list line shows. The content of the proposal the person approves comes from
 * `get_pending_action`; the list only names what is waiting.
 */
export const LISTED_EFFECTS = 5;

/** An open proposal in the list: what, where and since when. */
interface ProposalSummaryWire {
  readonly pending_action_id: string;
  readonly discussion_id?: string;
  readonly proposed_at: string;
  readonly effects: readonly { readonly page_id: string; readonly property_id: string }[];
  /** How many effects the proposal has in all, including any beyond those shown. */
  readonly effects_total: number;
}

/** Open proposals, oldest first; `truncated` means more are open than are shown. */
export interface ProposalListWire {
  readonly proposals: readonly ProposalSummaryWire[];
  readonly truncated?: true;
}

/**
 * What happened to the decision: it was accepted, or the proposal no longer waits (`INV-030`: no
 * queue bookkeeping).
 */
export interface ProposalDecisionResultWire {
  readonly pending_action_id: string;
  readonly decision: 'approve' | 'reject';
  readonly accepted: boolean;
}

/** Builds a list line in which effects are named by page and property only. */
export function proposalSummaryOf(row: PendingAction): ProposalSummaryWire {
  const effects = effectsSchema.parse(row.effects);

  return {
    pending_action_id: row.id,
    ...(row.discussionId ? { discussion_id: row.discussionId } : {}),
    proposed_at: row.createdAt.toISOString(),
    effects: effects
      .slice(0, LISTED_EFFECTS)
      .map((effect) => ({ page_id: effect.pageId, property_id: effect.propertyId })),
    effects_total: effects.length,
  };
}

/**
 * The state of a proposal as the model sees it: the status and the content — what the person
 * approves — and the lifecycle times. Execution bookkeeping is not part of it (`INV-030`): the
 * fingerprint, the failure reason and “not before” are the executor's job, not the model's.
 *
 * `staged` marks a proposal this run has staged. The proposal has not been made yet, so it has no
 * proposal time. It is shown in the same form as a row.
 */
export interface ProposalStateWire {
  readonly pending_action_id: string;
  readonly status: PendingActionStatus | 'staged';
  readonly discussion_id?: string;
  readonly effects: readonly EffectWire[];
  readonly preconditions: readonly PreconditionWire[];
  readonly proposed_at?: string;
  readonly resolved_at?: string;
}

/** No proposal has this id, either in storage or among those the run has staged. */
export interface ProposalAbsentWire {
  readonly pending_action_id: string;
  readonly found: false;
}

interface ProposalMoments {
  readonly proposedAt?: Date;
  readonly resolvedAt?: Date | null;
}

function proposalViewOf(
  id: string,
  status: ProposalStateWire['status'],
  proposal: Proposal,
  moments: ProposalMoments,
): ProposalStateWire {
  return {
    pending_action_id: id,
    status,
    ...(proposal.discussionId ? { discussion_id: proposal.discussionId } : {}),
    effects: proposal.effects.map((effect) => ({
      kind: effect.kind,
      page_id: effect.pageId,
      property_id: effect.propertyId,
      value: valueWireOf(effect.value),
    })),
    preconditions: proposal.preconditions.map(preconditionWireOf),
    ...(moments.proposedAt ? { proposed_at: moments.proposedAt.toISOString() } : {}),
    ...(moments.resolvedAt ? { resolved_at: moments.resolvedAt.toISOString() } : {}),
  };
}

/**
 * Converts a proposal row to its form on the wire. The stored content is read with the same
 * schemas as on input, so a row this version does not recognize is an error, not a silently
 * trimmed display.
 */
export function proposalStateOf(row: PendingAction): ProposalStateWire {
  const proposal: Proposal = {
    discussionId: row.discussionId ?? undefined,
    effects: effectsSchema.parse(row.effects),
    preconditions: preconditionsSchema.parse(row.preconditions),
  };

  return proposalViewOf(row.id, row.status, proposal, {
    proposedAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  });
}

/** Converts a proposal staged by a run, which is not a row yet, to its form on the wire. */
export function stagedProposalOf(staged: StagedProposal): ProposalStateWire {
  return proposalViewOf(staged.provisionalId, 'staged', staged.proposal, {});
}

function preconditionWireOf(precondition: Precondition): PreconditionWire {
  switch (precondition.kind) {
    case 'page_exists':
      return { kind: precondition.kind, page_id: precondition.pageId };
    case 'property_equals':
      return {
        kind: precondition.kind,
        page_id: precondition.pageId,
        property_id: precondition.propertyId,
        option_id: precondition.optionId,
      };
    case 'property_empty':
      return {
        kind: precondition.kind,
        page_id: precondition.pageId,
        property_id: precondition.propertyId,
      };
    case 'property_reads_as':
      return {
        kind: precondition.kind,
        page_id: precondition.pageId,
        property_id: precondition.propertyId,
        value: valueWireOf(precondition.value),
      };
    case 'unchanged_since':
      return {
        kind: precondition.kind,
        page_id: precondition.pageId,
        last_edited_time: precondition.lastEditedTime,
      };
  }
}
