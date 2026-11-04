import { z } from 'zod';
import { MEMORY_ENTRY_KINDS } from '../knowledge/memory-entry';
import { MemoryEntryRequest } from './memory-entry.schema';

/**
 * A memory entry on the wire of the App MCP (`record_memory`): the same fields as in
 * `memoryEntrySchema`, under their wire names.
 */
export const memoryEntryWireSchema = z.strictObject({
  object_page_id: z.string().min(1).optional(),
  kind: z.enum(MEMORY_ENTRY_KINDS),
  text: z.string(),
  date: z.string(),
  source_page_id: z.string().min(1).optional(),
  source_discussion_id: z.string().min(1).optional(),
});

export type MemoryEntryWire = z.infer<typeof memoryEntryWireSchema>;

export function memoryEntryRequestOf(wire: MemoryEntryWire): MemoryEntryRequest {
  return {
    objectId: wire.object_page_id,
    kind: wire.kind,
    text: wire.text,
    date: wire.date,
    sourcePageId: wire.source_page_id,
    sourceDiscussionId: wire.source_discussion_id,
  };
}
