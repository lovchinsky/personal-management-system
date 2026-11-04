import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { AttentionService } from '../attention/attention.service';
import { CaptureService } from '../capture/capture.service';
import { ContinuationsService } from '../continuations/continuations.service';
import { DeliveryService } from '../delivery/delivery.service';
import { MemoryService } from '../memory/memory.service';
import { Actor, RunActor } from '../runs/actor';
import { ImmediateWrites } from './immediate-writes';
import { StagedWrites } from './staged-writes';
import { WriteOwners } from './write-kinds';
import { writeOwners } from './write-owners';

/**
 * Provides the write policies. Each run gets its own deferred policy, and each chat session gets a
 * policy that writes at once. Both policies work over the same table of owners.
 */
@Injectable()
export class RunWrites {
  private readonly owners: WriteOwners;

  constructor(
    capture: CaptureService,
    attention: AttentionService,
    continuations: ContinuationsService,
    approvals: ApprovalsService,
    delivery: DeliveryService,
    memory: MemoryService,
  ) {
    this.owners = writeOwners({ capture, attention, continuations, approvals, delivery, memory });
  }

  /**
   * Creates the run's policy: writes wait for the conclusion and are applied up to the run's
   * deadline.
   */
  open(actor: RunActor, deadline: AbortSignal): StagedWrites {
    return new StagedWrites(actor, this.owners, deadline);
  }

  /** Creates the chat's policy: the same owners, but a write is applied at once (ADR 0015). */
  immediate(actor: Actor): ImmediateWrites {
    return new ImmediateWrites(actor, this.owners);
  }
}
