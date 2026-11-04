import { WritePolicy } from '../../effects/write-policy';
import { WorkflowMode } from '../../generated/prisma/enums';
import { Actor } from '../../runs/actor';

/** Who is speaking to the App MCP: a run with a ledger row or the person in a chat. */
export type McpIdentity =
  | {
      readonly surface: 'run';
      readonly runId: string;
      readonly mode: WorkflowMode;
      /** The cause of the run (the envelope's `event_id`): the App derives effect keys from it. */
      readonly cause: string;
    }
  | { readonly surface: 'chat' };

/**
 * An App MCP session is what a tool sees about its caller: on whose behalf the caller speaks,
 * which App tools it is shown and how the session's writes are applied.
 *
 * There are two sessions. A run has a ticket, a deferred write policy and a row of the
 * mode → toolset matrix (`RunSession`). A chat has the person, a policy that writes at once and
 * the `chat_toolset` (`ChatSession`). The tool is the same for both.
 */
export interface McpSession {
  readonly identity: McpIdentity;
  readonly actor: Actor;
  /** The App tools the session sees. The `tools/list` of its server is the same set. */
  readonly tools: ReadonlySet<string>;
  readonly writes: WritePolicy;
}
