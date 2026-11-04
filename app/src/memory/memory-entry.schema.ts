import { z } from 'zod';
import { squash } from '../knowledge/anchor-drift';
import { KINDS_NEEDING_OBJECT, MEMORY_ENTRY_KINDS } from '../knowledge/memory-entry';
import { discussionIdSchema, notionIdSchema } from '../notion/client/notion-id';

/**
 * The longest text an entry can have. A memory entry is one line: a decision, a fact or an event
 * in the person's words, not a summary of a conversation.
 */
const MAX_ENTRY_CHARS = 500;

/**
 * A memory entry is a system intent (`docs/2-system.md` § “Writes to GBrain”): which Notion
 * object it is about, which kind, what it says, on which day, and where it was said or read.
 * The App decides where and in what form the entry lands in GBrain: the object's anchor by exact
 * identity, the form by the kind.
 *
 * `objectId` is the Project, Behavior System, Objective, Area of Focus or Identity the entry is
 * about; without it a decision and a fact are written with no entity. `sourcePageId` and
 * `sourceDiscussionId` are the page and thread the entry comes from; without a page the source
 * is a conversation.
 */
export const memoryEntrySchema = z
  .strictObject({
    objectId: notionIdSchema.optional(),
    kind: z.enum(MEMORY_ENTRY_KINDS),
    text: z
      .string()
      .transform(squash)
      .pipe(
        z
          .string()
          .min(1, 'the entry is empty')
          .max(MAX_ENTRY_CHARS, `longer than ${MAX_ENTRY_CHARS} characters`),
      ),
    date: z.iso.date('a calendar day, YYYY-MM-DD'),
    sourcePageId: notionIdSchema.optional(),
    sourceDiscussionId: discussionIdSchema.optional(),
  })
  .refine(
    (entry) => entry.objectId !== undefined || !KINDS_NEEDING_OBJECT.includes(entry.kind),
    'an event and an acceptable state name the object they belong to (object_page_id)',
  )
  .refine(
    (entry) => entry.sourceDiscussionId === undefined || entry.sourcePageId !== undefined,
    'a thread is named together with the page it is on',
  );

/** An entry as requested: the ids are not yet normalized. */
export type MemoryEntryRequest = z.input<typeof memoryEntrySchema>;

/** An entry after the schema check. */
export type MemoryEntry = z.output<typeof memoryEntrySchema>;
