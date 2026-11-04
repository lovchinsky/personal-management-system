import { z } from 'zod';
import { notionIdSchema } from '../../notion/client/notion-id';
import { changedByDecoding, propertyIdFromCanonical } from '../../notion/client/property-id';
import { canonicalWriteSchema } from '../../notion/semantics/canonical-write';

/**
 * A property ID is canonical. The model sees only canonical IDs (the trigger envelope,
 * `get_schema_mapping`), so the form is not guessed here, and an ID that looks encoded is refused
 * with a named reason. Otherwise a proposal whose effect and precondition were encoded the same
 * way would pass the check. After approval it would not find its property and would go to
 * `conflict`, spending the person's decision. The same definition reads the stored row too, where
 * the translation changes nothing.
 */
export const propertyIdSchema = z
  .string()
  .min(1)
  .refine((id) => !changedByDecoding(id), {
    message: 'property id looks percent-encoded; proposals carry canonical ids',
  })
  .transform(propertyIdFromCanonical);

/**
 * Preconditions are strict on both sides: at input and when reading a stored row.
 *
 * An extra field of a precondition cannot be silently dropped: whoever added it meant a stronger
 * check, and with the field dropped the check would be weaker than intended. For the same reason,
 * a row written by a version that knows more fields is not executed by this version but declared
 * unrecognizable: a precondition that is only partly understood is not checked halfway.
 *
 * The page id in a precondition and in an effect is canonical. The match between effect and
 * precondition, the subject of the write and the fingerprint all compare ids, and the model may
 * take an id from a URL, where there are no hyphens.
 */
const preconditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('page_exists'), pageId: notionIdSchema }),
  z.strictObject({
    kind: z.literal('property_equals'),
    pageId: notionIdSchema,
    propertyId: propertyIdSchema,
    optionId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('property_empty'),
    pageId: notionIdSchema,
    propertyId: propertyIdSchema,
  }),
  // The value is in canonical form, the same one effects are written in: the precondition reads
  // the property the way the adapter reads it, not by the physical payload.
  z.strictObject({
    kind: z.literal('property_reads_as'),
    pageId: notionIdSchema,
    propertyId: propertyIdSchema,
    value: canonicalWriteSchema,
  }),
  z.strictObject({
    kind: z.literal('unchanged_since'),
    pageId: notionIdSchema,
    lastEditedTime: z.string().min(1),
  }),
]);

/**
 * The preconditions under which an approved action still makes sense.
 *
 * The list is in `docs/2-system.md` § “Preconditions and executor”. Revalidation is possible
 * only for semantics that have a physical property: prose in the body, emergent semantics and
 * values reachable by traversal are observed only through `unchanged_since`. It reacts to any
 * edit of the page by someone else and does not see the system's own write in the same minute.
 * So an action whose effect is in the page body cannot be proposed: nothing could keep it
 * once-only, and it is better to refuse loudly than to promise what does not exist.
 */
export type Precondition = z.infer<typeof preconditionSchema>;

/** A precondition as composed by whoever proposes: the ids are not yet translated. */
export type PreconditionRequest = z.input<typeof preconditionSchema>;

/**
 * The lists of preconditions and effects have no lower bound, on purpose, and are the same for
 * the request, the stored row and the display. Whether there are enough of them and whether each
 * action has a precondition of its own that sees it is decided by `validateProposal`. It is one
 * function for both clauses of the validity rule, and execution reruns that same function. A
 * second bound here would answer before `validateProposal` does, and the refusal would no longer
 * name the defect.
 */
export const preconditionsSchema = z.array(preconditionSchema).readonly();
