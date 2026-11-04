import {
  memoryEntryRequestOf,
  MemoryEntryWire,
  memoryEntryWireSchema,
} from '../../../memory/memory-entry.wire';
import { AppTool, defineTool, ToolContext, writeAnswer, WRITES } from './app-tool';

/** Writes a memory entry. The memory capability decides where it lands and in what form. */
async function record(context: ToolContext, input: MemoryEntryWire): Promise<object> {
  await context.session.writes.submit('memory_entry', memoryEntryRequestOf(input));

  return writeAnswer(context, {
    kind: input.kind,
    ...(input.object_page_id === undefined ? {} : { object_page_id: input.object_page_id }),
  });
}

export const MEMORY_TOOLS: readonly AppTool[] = [
  defineTool({
    name: 'record_memory',
    capability: 'memory_record',
    // The response is the write marker, the kind and the object.
    bound: 1_000,
    description:
      "Keep one entry in long-term memory, in the system's voice. kind: event (something " +
      'significant happened in the history of the object, with a source), decision (an ' +
      'explicit choice the person stated), fact (something the person stated), standard (what ' +
      'the person called normal for an Area of Focus). object_page_id: the Project, Behavior ' +
      'System, Objective, Area of Focus or Identity the entry is about; omit it when the entry ' +
      'is about none of them (an event and a standard always name one). text: one line, the ' +
      "person's words for a decision, a fact or a standard. date: the day it happened or was " +
      'said, YYYY-MM-DD. source_page_id and source_discussion_id: the page and thread where ' +
      'you read or heard it. Memory finds the page of the object, creates it when the object ' +
      'has none, writes the entry in the form its kind needs and skips an identical entry it ' +
      'already holds. A refusal says why nothing is kept. ' +
      WRITES,
    inputSchema: memoryEntryWireSchema,
    handle: record,
  }),
];
