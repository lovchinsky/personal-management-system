import { RequestOf, StagedWrite, WriteKind } from './write-kinds';

/**
 * What an App MCP tool needs from the write policy (ADR 0015): accept a write, show what this step
 * has written, and refuse or poison the session.
 *
 * There are two policies. A run defers writes until a valid result (`StagedWrites`, ADR 0014);
 * the chat writes at once (`ImmediateWrites`): it has no run result, so there is no way to write
 * “at the end”. The tool is the same for both; only what it tells the model about the writes
 * differs.
 */
export interface WritePolicy {
  /** Writes wait for the end of the run (`true`) or are already applied at the call (`false`). */
  readonly deferred: boolean;

  /**
   * Accepts a write. `ref` is a temporary id under a deferred policy and a real id under an
   * immediate policy.
   */
  submit<K extends WriteKind>(kind: K, request: RequestOf<K>): Promise<StagedWrite<K>>;

  /** Returns what was written in this step and not yet applied: empty for the immediate policy. */
  pending<K extends WriteKind>(kind: K): readonly StagedWrite<K>[];

  /** Receives a capability's refusal: the model can fix the request. */
  refuse(tool: string, reason: string): void;

  /** Receives a failure after which the step's writes cannot be trusted. */
  poison(reason: string): void;
}
