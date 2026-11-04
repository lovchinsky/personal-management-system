import { z } from 'zod';
import { MAX_COMMENT_CHARS } from '../attention/comment.schema';
import type { OpenTaskStatus } from '../methodology/lifecycle';
import { notionIdSchema } from '../notion/client/notion-id';
import { linksSchema, momentSchema } from '../notion/semantics/canonical-write';
import type { Assert } from '../platform/types/assert';

/**
 * The statuses a conversion creates a Task with: the open canonical ones. A closed Task from
 * an Inbox item is not a conversion but a conclusion the person did not draw. The system also
 * never writes a non-canonical value (`contracts/canonical.yaml`, key `capture_policy_rules`).
 */
export const OPEN_TASK_STATUSES = [
  'Next Action',
  'Scheduled',
  'Waiting For',
  'Someday/Maybe',
] as const;

/**
 * A conversion creates a Task with exactly the methodology's open statuses. If they diverge,
 * the build fails.
 */
export type ConversionStatusesAreTheOpenOnes = Assert<
  [(typeof OPEN_TASK_STATUSES)[number]] extends [OpenTaskStatus]
    ? [OpenTaskStatus] extends [(typeof OPEN_TASK_STATUSES)[number]]
      ? true
      : false
    : false
>;

/** The longest Task name allowed: a name is not a description but what the Task is found by. */
const MAX_TASK_NAME_CHARS = 500;

/**
 * The Task an item is converted into: an L0 Task with only the fields a conversion is allowed
 * to write. There is no link to a Behavior System here, and no body either (`INV-008`): the
 * schema does not know fields of either kind, and a request with them is refused.
 */
const taskSchema = z.strictObject({
  name: z.string().trim().min(1, 'the task name is empty').max(MAX_TASK_NAME_CHARS),
  status: z.enum(OPEN_TASK_STATUSES),
  date: momentSchema.optional(),
  deadline: momentSchema.optional(),
  project: linksSchema.optional(),
  areaOfFocus: linksSchema.optional(),
  keyResults: linksSchema.optional(),
  dependencies: linksSchema.optional(),
});

/**
 * Converting an Inbox item into a Task is a system intent (ADR 0017): the Task, an origin
 * comment on the item, the trash.
 *
 * The comment is text for the person about what the item became: the App appends a mention
 * of the created Task to it. Extra fields get a refusal, not silence (`INV-090`).
 */
export const inboxConversionSchema = z.strictObject({
  inboxPageId: notionIdSchema,
  task: taskSchema,
  comment: z
    .string()
    .trim()
    .min(1, 'the origin comment is empty')
    .max(MAX_COMMENT_CHARS, `longer than ${MAX_COMMENT_CHARS} characters`),
});

/** The conversion as requested: ids are not yet in canonical form. */
export type InboxConversionRequest = z.input<typeof inboxConversionSchema>;

/** The conversion after the schema check. */
export type InboxConversion = z.output<typeof inboxConversionSchema>;

export type ConvertedTask = InboxConversion['task'];
