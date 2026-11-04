import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { messageOf, stackOf } from '../platform/error/message-of';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { RunActor } from '../runs/actor';
import { AppliedEffect, EffectsReport, RefusedCall } from '../runs/run-effects';
import { RefKind, Refs } from './refs';
import { APPLY_ORDER, RequestOf, StagedWrite, WriteKind, WriteOwners } from './write-kinds';
import { WritePolicy } from './write-policy';

/**
 * The deferred write policy of one run (ADR 0014, ADR 0015): what has been staged waits for the
 * conclusion and is applied only when the dispatcher has judged the result valid.
 *
 * The policy only holds the writes and decides when to apply them. Their owners check and apply
 * them, and these are the same capabilities as for any other input. The same capabilities show the
 * writes through their reads.
 */
export class StagedWrites implements Refs, WritePolicy {
  /** Writes wait for the run to end: the dispatcher applies them when the conclusion is valid. */
  readonly deferred = true;

  private readonly logger = new Logger(StagedWrites.name);

  /** What has been staged, separately by kind, each kind in the order it was written. */
  private readonly staged: { readonly [K in WriteKind]: StagedWrite<K>[] } = {
    memory_entry: [],
    inbox_item: [],
    inbox_conversion: [],
    inbox_closure: [],
    comment: [],
    continuation: [],
    proposal: [],
    delivery: [],
  };
  private readonly refusals: RefusedCall[] = [];
  /** The temporary id of an applied write → the real id of what it created. */
  private readonly real = new Map<string, string>();
  private poisoned?: string;
  private ended = false;

  constructor(
    readonly actor: RunActor,
    private readonly owners: WriteOwners,
    /** The run's deadline: writes are applied up to it. */
    private readonly deadline: AbortSignal,
  ) {}

  /** No write is accepted any more: applying or discarding has already started. */
  get closed(): boolean {
    return this.ended;
  }

  /**
   * Accepts a write: the owner checks it, and the policy defers it. It returns the checked write
   * and its temporary id.
   */
  async submit<K extends WriteKind>(kind: K, request: RequestOf<K>): Promise<StagedWrite<K>> {
    this.assertOpen();

    const write = await this.owners[kind].check(this.actor, request, this);

    // The check is asynchronous: while it ran, applying may already have begun.
    this.assertOpen();

    const staged: StagedWrite<K> = { kind, write, ref: randomUUID() };

    this.staged[kind].push(staged);

    return staged;
  }

  /** Returns what this run has staged of one kind, in the order it was written. */
  pending<K extends WriteKind>(kind: K): readonly StagedWrite<K>[] {
    return [...this.staged[kind]];
  }

  minted(kind: RefKind, id: string): boolean {
    return APPLY_ORDER.some(
      (writeKind) =>
        this.owners[writeKind].mints === kind &&
        this.staged[writeKind].some((staged) => staged.ref === id),
    );
  }

  resolve(kind: RefKind, id: string): string {
    if (!this.minted(kind, id)) return id;

    const real = this.real.get(id);
    if (real === undefined) {
      throw new Error(`${kind} ${id} is referenced before the write that minted it was applied`);
    }

    return real;
  }

  /**
   * Receives a capability's refusal: the model can fix the request, and the refusal is recorded in
   * the run trace.
   */
  refuse(tool: string, reason: string): void {
    this.refusals.push({ tool, reason });
  }

  /**
   * Receives a failure that the model learned of only as transient. The model composed the rest of
   * its plan without knowing what had happened to this call, so the run's writes are no longer
   * applied.
   */
  poison(reason: string): void {
    this.poisoned ??= reason;
  }

  /**
   * Applies the run's writes in the order of kinds.
   *
   * First everything that was staged is checked again: state that changed during the run — a
   * snooze the person set in the meantime, or a proposal the person has already decided — stops
   * applying before the first write. A refusal that arises between this check and a write stops
   * the rest, while what was applied before it stays and is recorded in the trace. Applying
   * continues until the run's deadline and stops there, and a write waiting for an external system
   * cuts its wait short. An error becomes a `failure`, not an exception, as the `RunEffects` port
   * specifies. The stack of an error that a capability did not classify as a refusal stays in the
   * log.
   */
  async commit(): Promise<EffectsReport> {
    this.ended = true;

    const report = this.report();

    if (this.poisoned) return { ...report, failure: `the session was poisoned — ${this.poisoned}` };

    const ordered: StagedWrite[] = [];

    for (const kind of APPLY_ORDER) ordered.push(...this.staged[kind]);

    const applied: AppliedEffect[] = [];

    try {
      for (const write of ordered) await this.recheck(write);

      for (const write of ordered) await this.apply(write, (effect) => applied.push(effect));
    } catch (error) {
      // What was applied before the failure cannot be undone: it stays and is recorded in the trace
      // together with the reason.
      if (!(error instanceof InvalidRequestError)) {
        this.logger.error(
          `${this.actor.runId}: committing the writes failed — ${messageOf(error)}`,
          stackOf(error),
        );
      }

      return { ...report, applied, failure: messageOf(error) };
    }

    return { ...report, applied };
  }

  /** Discards the run's writes. It does not throw: the policy only forgets them. */
  discard(): EffectsReport {
    this.ended = true;

    return this.report();
  }

  private assertOpen(): void {
    if (this.ended) throw new Error(`${this.actor.runId}: the session is closed`);
  }

  private report(): EffectsReport {
    return { applied: [], refused: [...this.refusals] };
  }

  private async recheck<K extends WriteKind>(staged: StagedWrite<K>): Promise<void> {
    await this.owners[staged.kind].check(this.actor, staged.write, this);
  }

  private async apply<K extends WriteKind>(
    staged: StagedWrite<K>,
    applied: (effect: AppliedEffect) => void,
  ): Promise<void> {
    this.deadline.throwIfAborted();

    const real = await this.owners[staged.kind].apply(
      this.actor,
      staged.write,
      this,
      applied,
      this.deadline,
    );

    this.real.set(staged.ref, real);
  }
}
