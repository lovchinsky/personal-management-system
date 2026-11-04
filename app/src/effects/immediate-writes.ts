import { Logger } from '@nestjs/common';
import { Actor } from '../runs/actor';
import { AppliedEffect } from '../runs/run-effects';
import { Refs } from './refs';
import { RequestOf, StagedWrite, WriteKind, WriteOwners } from './write-kinds';
import { WritePolicy } from './write-policy';

/**
 * There are no references between writes in the chat. Each write is applied at the call, so the
 * model already has the real id and refers to that one.
 */
const NO_REFS: Refs = {
  minted: () => false,
  resolve: (_kind, id) => id,
};

/**
 * The chat write policy (ADR 0014, ADR 0015): a write is checked by its owner and applied at once.
 *
 * The chat has no run result, and the person is present. A failure or refusal comes back to the
 * person and to the model on the same call, and the person retries. So nothing is deferred, and
 * “discard the run” means nothing. The table of owners is the same as the run's: checking and
 * applying are the same for the chat.
 *
 * The chat has no run trace: only an App-triggered run goes through one. Applied effects go to
 * the structured log, where what the App did on the chat's behalf can be seen.
 */
export class ImmediateWrites implements WritePolicy {
  readonly deferred = false;

  private readonly logger = new Logger(ImmediateWrites.name);

  constructor(
    private readonly actor: Actor,
    private readonly owners: WriteOwners,
  ) {}

  async submit<K extends WriteKind>(kind: K, request: RequestOf<K>): Promise<StagedWrite<K>> {
    const owner = this.owners[kind];
    const write = await owner.check(this.actor, request, NO_REFS);
    const ref = await owner.apply(this.actor, write, NO_REFS, (effect) => this.record(effect));

    const applied: StagedWrite<K> = { kind, write, ref };

    return applied;
  }

  pending(): readonly never[] {
    return [];
  }

  /** The model reads a refusal in the tool's response; there is nowhere to keep it. */
  refuse(): void {
    return undefined;
  }

  /** The chat has no session to poison: each call stands on its own. */
  poison(): void {
    return undefined;
  }

  private record(effect: AppliedEffect): void {
    this.logger.log(`chat applied ${effect.kind} ${effect.id}`);
  }
}
