import { isBefore } from 'date-fns';
import { StagedWrites } from '../../effects/staged-writes';
import { RunActor } from '../../runs/actor';
import { EffectsGrant } from '../../runs/run-effects';
import { serverTools } from '../../runs/toolsets';
import { McpIdentity, McpSession } from './mcp-session';

/**
 * The session of one run in the App MCP: on whose behalf it speaks, what it can see and where
 * its writes go.
 *
 * The session only holds the identity and the limits. What is written is kept by the deferred
 * write policy (ADR 0015), the writes are checked and applied by their capabilities, and the
 * dispatcher decides whether to apply them.
 */
export class RunSession implements McpSession {
  /**
   * The App tools of the run's row in the mode → toolset matrix. The session's `tools/list` is
   * the same set.
   */
  readonly tools: ReadonlySet<string>;

  constructor(
    readonly grant: EffectsGrant,
    readonly writes: StagedWrites,
  ) {
    this.tools = new Set(serverTools(grant.mode, 'app'));
  }

  get actor(): RunActor {
    return this.writes.actor;
  }

  get identity(): McpIdentity {
    return {
      surface: 'run',
      runId: this.grant.runId,
      mode: this.grant.mode,
      cause: this.grant.cause,
    };
  }

  /**
   * Checks whether the session accepts calls: writes are not yet being applied and the ticket has
   * not expired.
   */
  accepts(): boolean {
    return !this.writes.closed && isBefore(new Date(), this.grant.expiresAt);
  }
}
