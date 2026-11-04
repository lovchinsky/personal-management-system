import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ApprovalsService } from '../../../approvals/approvals.service';
import { ContinuationsService } from '../../../continuations/continuations.service';
import { DeliveryService } from '../../../delivery/delivery.service';
import { SchemaMappingReader } from '../../../notion/semantics/schema-mapping.reader';
import type { Gender } from '../../../texts/gender';
import { McpSession } from '../mcp-session';

/** When a write that a write tool accepted in a run is applied. */
const APPLIES = 'when this run concludes with a valid result';

/**
 * What a write tool says about itself in its description. One tool serves runs and chats alike,
 * while their write policies differ (ADR 0015): a run stages the write until a valid result, a
 * chat applies it on the call.
 */
export const WRITES = `In a run the write is staged and applies ${APPLIES}; in a chat it applies at once.`;

/**
 * Returns a write tool's response: what was written and when it is applied. A run is told that
 * the write is staged, and a chat that it is already applied, so the model does not have to guess
 * whether it can tell the person “done”.
 */
export function writeAnswer(
  context: Pick<ToolContext, 'session'>,
  fields: Readonly<Record<string, unknown>>,
): object {
  return context.session.writes.deferred
    ? { staged: true, applies: APPLIES, ...fields }
    : { applied: true, ...fields };
}

/**
 * What a tool sees in the session: on whose behalf it speaks and where its writes go. Writes are
 * only accepted and shown; applying and discarding a run's writes belong to the dispatcher
 * (ADR 0015).
 */
type ToolSession = Pick<McpSession, 'actor' | 'identity'> & {
  readonly writes: Pick<McpSession['writes'], 'submit' | 'pending' | 'deferred'>;
};

/**
 * Everything a tool talks to: the session (a run's or a chat's), the reads of the capabilities and
 * the response that decides what becomes of an error — a refusal for the model or a failure that
 * poisons the session.
 *
 * A tool gets capabilities only for reading. It can write only through the session: a tool that
 * called `schedule` or `enqueue` itself would bypass the deferred write policy (ADR 0014,
 * ADR 0015), so the compiler does not let it.
 */
export interface ToolContext {
  readonly session: ToolSession;
  readonly continuations: Pick<ContinuationsService, 'state'>;
  readonly delivery: Pick<DeliveryService, 'state' | 'window'>;
  readonly approvals: Pick<ApprovalsService, 'openLike' | 'state' | 'listOpen' | 'decide'>;
  readonly schema: Pick<SchemaMappingReader, 'read'>;
  /** The installation's time zone, read when a tool asks for it. */
  timeZone(): string;
  /** The grammatical gender for addressing the owner (ADR 0046). */
  ownerGender(): Gender;
  /** The assistant name; `null` means the assistant has no name (ADR 0049). */
  assistantName(): string | null;
  /** The grammatical gender the assistant uses when it speaks of itself (ADR 0046). */
  assistantGender(): Gender;
  respond(tool: string, work: () => Promise<object>): Promise<CallToolResult>;
}

/**
 * An App MCP tool: its name, response bound and registration on the session's server.
 *
 * The bound is kept apart from the registration because `INV-303` checks it without a server.
 */
export interface AppTool {
  readonly name: string;
  readonly capability: string;
  /** How many characters a response may return (`INV-303`). */
  readonly bound: number;
  /** Returns the description the model sees, with the capability label. */
  describe(): string;
  register(server: McpServer, context: ToolContext): void;
}

/** A tool as a capability declares it: what the model sees and what a call does. */
interface ToolDefinition<Input> {
  readonly name: string;
  /**
   * The capability from `contracts/canonical.yaml`, key `mcp_toolsets.app.capabilities`, that
   * the tool belongs to. The Skill refers to a capability, not to a tool name (`INV-308`), so the
   * model finds its tool by the `[capability: …]` label at the end of the description.
   */
  readonly capability: string;
  readonly bound: number;
  readonly description: string;
  readonly inputSchema: z.ZodType<Input>;
  handle(context: ToolContext, input: Input): Promise<object>;
}

/**
 * Returns the description the model sees: the text the capability declares and its capability
 * label.
 */
function describedBy({
  description,
  capability,
}: Pick<ToolDefinition<unknown>, 'description' | 'capability'>): string {
  return `${description} [capability: ${capability}]`;
}

/**
 * Builds a tool from its declaration. The name is written once, and `respond` converts the call
 * error of every tool in the same way: a refusal for the model, a failure that poisons the
 * session.
 */
export function defineTool<Input>(tool: ToolDefinition<Input>): AppTool {
  return {
    name: tool.name,
    capability: tool.capability,
    bound: tool.bound,
    describe: () => describedBy(tool),
    register: (server, context) => {
      server.registerTool(
        tool.name,
        { inputSchema: tool.inputSchema, description: describedBy(tool) },
        (input) => context.respond(tool.name, () => tool.handle(context, input)),
      );
    },
  };
}
