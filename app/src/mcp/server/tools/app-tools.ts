import { AppTool } from './app-tool';
import { APPROVAL_TOOLS } from './approval.tools';
import { ATTENTION_TOOLS } from './attention.tools';
import { CAPTURE_TOOLS } from './capture.tools';
import { CONTINUATION_TOOLS } from './continuation.tools';
import { DELIVERY_TOOLS } from './delivery.tools';
import { INTROSPECTION_TOOLS } from './introspection.tools';
import { MEMORY_TOOLS } from './memory.tools';

/**
 * The App MCP tools: one table for registration and for the response bounds.
 *
 * A session sees only the tools of the App bundles in the row for its run's mode. Each tool is a
 * thin layer over a capability: it translates wire data into a service call and submits writes to
 * the session's write policy (ADR 0015).
 */
export const APP_TOOLS: readonly AppTool[] = [
  ...ATTENTION_TOOLS,
  ...CAPTURE_TOOLS,
  ...CONTINUATION_TOOLS,
  ...DELIVERY_TOOLS,
  ...APPROVAL_TOOLS,
  ...MEMORY_TOOLS,
  ...INTROSPECTION_TOOLS,
];

/**
 * How many characters each tool may return. None returns an unbounded collection: the state of
 * continuations is bounded per query, a proposal is bounded at write time, and the mapping
 * bounds itself. `test/contract/inv-303.spec.ts` checks the bounds against the limit on a tool
 * result in a run.
 */
export const RESULT_BOUNDS_CHARS: Readonly<Record<string, number>> = Object.fromEntries(
  APP_TOOLS.map((tool) => [tool.name, tool.bound]),
);
