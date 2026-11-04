import { z } from 'zod';
import { discussionIdSchema, notionIdSchema } from '../notion/client/notion-id';
import { canonicalWriteSchema } from '../notion/semantics/canonical-write';
import { preconditionsSchema, propertyIdSchema } from './preconditions/precondition';

/**
 * What the action will change: the page, the property and the canonical value
 * (`contracts/canonical.yaml`, keys `pending_action` and `canonical_writes`).
 *
 * The proposal declares the effect. The effect is not derived from the preconditions
 * (`docs/2-system.md` § “Preconditions and executor”). The value is the same one the person will
 * see and the executor will write: what is shown and what is written are one object.
 *
 * The schema is strict for the same reason as the preconditions: an effect read only in part
 * would look for its precondition in the wrong place.
 */
export const effectSchema = z.strictObject({
  kind: z.literal('property_write'),
  pageId: notionIdSchema,
  propertyId: propertyIdSchema,
  value: canonicalWriteSchema,
});

export type ActionEffect = z.infer<typeof effectSchema>;

/** An effect as declared by whoever proposes: the ids are not yet translated. */
export type ActionEffectRequest = z.input<typeof effectSchema>;

/** See `preconditionsSchema`. */
export const effectsSchema = z.array(effectSchema).readonly();

/**
 * A proposal as the capability accepts it.
 *
 * Extra fields are a refusal, not silence: a silently dropped field would leave whoever proposes
 * sure that their precondition is recorded.
 */
export const proposalSchema = z.strictObject({
  discussionId: discussionIdSchema.optional(),
  /** What the action will change, with the values. Declared, not derived from preconditions. */
  effects: effectsSchema,
  preconditions: preconditionsSchema,
});

/** A proposal as composed by whoever proposes: the ids are not yet translated. */
export type ProposalRequest = z.input<typeof proposalSchema>;

/** A proposal after the check: the ids are in canonical form. */
export type Proposal = z.output<typeof proposalSchema>;

/**
 * A proposal that a run wrote and that will be applied at the end. The provisional id is a uuid,
 * like a real one: a delivery button of the same run can refer to it, and `kind:id` must fit in
 * `callback_data`.
 */
export interface StagedProposal {
  readonly provisionalId: string;
  readonly proposal: Proposal;
}
