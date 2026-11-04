import { z } from 'zod';
import { InboxConversionRequest, OPEN_TASK_STATUSES } from './inbox-conversion.schema';

const links = z.array(z.string().min(1));

/**
 * Conversion on the App MCP wire (`convert_inbox_item`): the same fields as in
 * `inboxConversionSchema`, under wire names. Only the shape lives here; the capability checks
 * the limits and rules of a conversion.
 */
export const inboxConversionWireSchema = z.strictObject({
  inbox_page_id: z.string().min(1),
  task: z.strictObject({
    name: z.string(),
    status: z.enum(OPEN_TASK_STATUSES),
    date: z.string().optional(),
    deadline: z.string().optional(),
    project: links.optional(),
    area_of_focus: links.optional(),
    key_results: links.optional(),
    dependencies: links.optional(),
  }),
  comment: z.string(),
});

export type InboxConversionWire = z.infer<typeof inboxConversionWireSchema>;

export function inboxConversionRequestOf(wire: InboxConversionWire): InboxConversionRequest {
  const { task } = wire;

  return {
    inboxPageId: wire.inbox_page_id,
    task: {
      name: task.name,
      status: task.status,
      date: task.date,
      deadline: task.deadline,
      project: task.project,
      areaOfFocus: task.area_of_focus,
      keyResults: task.key_results,
      dependencies: task.dependencies,
    },
    comment: wire.comment,
  };
}
