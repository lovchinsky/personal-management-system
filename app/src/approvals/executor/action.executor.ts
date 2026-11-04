import { Inject, Injectable, Logger } from '@nestjs/common';
import { isNotionClientError } from '@notionhq/client';
import { addSeconds, differenceInMilliseconds, hoursToMilliseconds } from 'date-fns';
import { PendingAction } from '../../generated/prisma/client';
import { PendingActionFailure } from '../../generated/prisma/enums';
import { BotIdentityUnknownError, UnconfirmedWriteError } from '../../notion/client/notion.error';
import { NotionWriter } from '../../notion/client/notion.writer';
import { Page } from '../../notion/client/page';
import { AdapterConfigurationError } from '../../notion/semantics/adapter.error';
import { confirmsWrite } from '../../notion/semantics/canonical-write';
import { notionFailureOf } from '../../notion/semantics/notion-failure';
import { SemanticAdapter } from '../../notion/semantics/semantic.adapter';
import { UnwritableOnPageError } from '../../notion/semantics/unwritable-on-page.error';
import { UnwritableValueError } from '../../notion/semantics/unwritable-value.error';
import { messageOf } from '../../platform/error/message-of';
import { PendingActionRepository } from '../contracts/pending-action.repository';
import { Precondition, preconditionsSchema } from '../preconditions/precondition';
import {
  FailedVerdict,
  PreconditionEvaluator,
  Unreachable,
} from '../preconditions/precondition.evaluator';
import { ActionEffect, effectsSchema } from '../proposal.schema';
import { describeDefect, validateProposal, writesOf } from '../proposal.validity';
import { executorConfig, type ExecutorConfig } from './executor.config';

/** A row read as an executable contract, or the reason it cannot be. */
type Contract =
  | {
      readonly ok: true;
      /** The page the write goes to. */
      readonly subject: string;
      readonly effects: readonly ActionEffect[];
      readonly preconditions: readonly Precondition[];
    }
  | { readonly ok: false; readonly reason: string };

/** What happened to the write: Notion answered, and the answer must be mapped to the fate. */
type WriteFailure =
  | { readonly fate: 'conflict'; readonly reason: string }
  | { readonly fate: 'failed'; readonly reason: string; readonly failure: PendingActionFailure }
  | { readonly fate: 'deferred'; readonly reason: string; readonly unreachable: Unreachable };

/**
 * Execution of an approved change as a system write.
 *
 * The sequence is normative (`docs/2-system.md` § “Approval-required writes”): reread the page
 * and the preconditions, refuse when the state has changed, encode the canonical values on the
 * page just checked, write in one request through `NotionWriter`, verify by reading back, record.
 *
 * The sequence itself makes execution once-only: there is one loop, the status is monotonic, the
 * preconditions observe the effect, and the write sets the same values. A retry after a failure
 * rereads the preconditions and returns `conflict`, not a second write.
 */
@Injectable()
export class ActionExecutor {
  private readonly logger = new Logger(ActionExecutor.name);

  constructor(
    private readonly actions: PendingActionRepository,
    private readonly preconditions: PreconditionEvaluator,
    private readonly semantics: SemanticAdapter,
    private readonly writer: NotionWriter,
    @Inject(executorConfig.KEY) private readonly config: ExecutorConfig,
  ) {}

  async execute(action: PendingAction): Promise<void> {
    const contract = this.contractOf(action);
    if (!contract.ok) {
      // A row that cannot be read as a contract can never be executed: it was either written by
      // another version or composed wrongly. `failed` is more honest here than retries, because
      // it needs attention and says what to apply that attention to.
      await this.settle(action.id, 'failed', contract.reason, 'other');

      return;
    }

    const verdict = await this.preconditions.evaluate(contract.subject, contract.preconditions);
    if (verdict.outcome !== 'holds') {
      return this.abandon(action, verdict);
    }

    let mismatches: readonly string[];

    // Verification by reading back sits inside the same `try` block as the write. Reading what was
    // written can fail just as writing can, and after the write a failed read-back is already the
    // action's fate, not an exception after which a retry would see its own write as a change of
    // state.
    try {
      mismatches = this.mismatches(contract.effects, await this.write(contract, verdict.subject));
    } catch (error) {
      const failure = failureOf(error);
      if (!failure) {
        throw error;
      }

      return this.settleFailure(action, failure);
    }

    if (mismatches.length > 0) {
      // Notion accepted the write and returns something else: what was executed is not what was
      // shown, and this must not be passed over in silence.
      return this.settleFailure(action, {
        fate: 'failed',
        reason: `Notion reads back what was not written: ${mismatches.join('; ')}`,
        failure: 'other',
      });
    }

    await this.settle(action.id, 'executed');
  }

  /**
   * Rechecks a proposal after the person changed the page where it waits. If the precondition no
   * longer holds, the proposal is closed as `conflict`. The recheck is the same mechanical check
   * that execution would make after the button press anyway (ADR 0044). If the precondition
   * holds, the request is cleared. If the state could not be inspected, the request stays until
   * the next tick.
   */
  async recheck(action: PendingAction): Promise<void> {
    const requestedAt = action.recheckRequestedAt;
    if (requestedAt === null) return;

    const contract = this.contractOf(action);
    // Execution will report a row that cannot be read as a contract, so there is nothing to judge
    // here.
    if (!contract.ok) return this.actions.rechecked(action.id, requestedAt);

    const verdict = await this.preconditions.evaluate(contract.subject, contract.preconditions);

    switch (verdict.outcome) {
      case 'broken':
        return this.actions.outpaced(
          action.id,
          `${verdict.failed.kind} ${verdict.outcome}: ${verdict.detail}`,
        );

      case 'holds':
      case 'undecidable':
        return this.actions.rechecked(action.id, requestedAt);

      case 'degraded':
        return;
    }
  }

  /**
   * Encodes the changes on the page the preconditions have just checked and writes them in one
   * request. The property type is taken from this page, not from the binding: the binding has no
   * types.
   */
  private async write(contract: Extract<Contract, { ok: true }>, page: Page): Promise<Page> {
    return this.writer.updateProperties(
      contract.subject,
      this.semantics.encodeOn(page, writesOf(contract.effects)),
    );
  }

  /** Returns the effects that Notion's answer does not confirm, as text for the reason. */
  private mismatches(effects: readonly ActionEffect[], written: Page): string[] {
    return effects.flatMap((effect) =>
      confirmsWrite(effect.value, this.semantics.readBack(written, effect.propertyId))
        ? []
        : [`${effect.propertyId} is not ${effect.value.kind}`],
    );
  }

  /**
   * Records the fate. The fate publication reports it in the thread's trail and in the message
   * (ADR 0043).
   */
  private async settle(id: string, fate: 'executed'): Promise<void>;
  private async settle(id: string, fate: 'conflict', reason: string): Promise<void>;
  private async settle(
    id: string,
    fate: 'failed',
    reason: string,
    failure: PendingActionFailure,
  ): Promise<void>;
  private async settle(
    id: string,
    fate: 'executed' | 'failed' | 'conflict',
    reason?: string,
    failure?: PendingActionFailure,
  ): Promise<void> {
    if (fate === 'executed') {
      await this.actions.settle(id, fate);
    } else if (fate === 'conflict') {
      await this.actions.settle(id, fate, reason ?? fate);
    } else {
      await this.actions.settle(id, fate, reason ?? fate, failure ?? 'other');
      this.logger.error(`action ${id} failed: ${reason ?? fate}`);
    }
  }

  private async settleFailure(action: PendingAction, failure: WriteFailure): Promise<void> {
    switch (failure.fate) {
      case 'deferred':
        return this.defer(action, failure.unreachable, failure.reason);

      case 'conflict':
        return this.settle(action.id, failure.fate, failure.reason);

      case 'failed':
        return this.settle(action.id, failure.fate, failure.reason, failure.failure);
    }
  }

  /**
   * Defers an action whose page could not be inspected or written: Notion is temporarily
   * unresponsive, the integration bot is not yet known or the integration lacks access.
   *
   * The domain has not changed because of these failures, so the action stays approved: `failed`
   * right away would mean the person has to decide again what they already decided. But not
   * without a limit (ADR 0044): temporary unavailability waits no longer than the limit measured
   * from the approval, and an access refusal, which does not clear on its own, no longer than the
   * attempt limit. Beyond that the action is `failed`, with the kind the trail in the thread uses
   * to tell the person why the approved change was not written. “Not before” is written to the
   * row, not to process memory: an in-memory map would not survive a restart and would not
   * exclude the deferred action from the selection.
   */
  private async defer(
    action: PendingAction,
    unreachable: Unreachable,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const accessDenied = unreachable === 'no_access';

    if (accessDenied && action.accessFailures + 1 >= this.config.noAccessMaxAttempts) {
      return this.settle(action.id, 'failed', reason, 'no_access');
    }

    if (!accessDenied && this.outlasted(action, now)) {
      return this.settle(action.id, 'failed', reason, 'unavailable');
    }

    const until = addSeconds(now, this.config.missingDependencyBackoffSeconds);

    await this.actions.deferUntil(action.id, until, reason, accessDenied);
    this.logger.warn(`action ${action.id} deferred: ${reason}`);
  }

  /**
   * Checks whether the approved action has waited longer than the limit for temporary
   * unavailability.
   */
  private outlasted(action: PendingAction, now: Date): boolean {
    const since = action.approvedAt ?? action.createdAt;

    return (
      differenceInMilliseconds(now, since) >= hoursToMilliseconds(this.config.unavailableMaxHours)
    );
  }

  /**
   * Reads a row as a contract, or returns the reason it cannot be read.
   *
   * Validity is checked **here too**, and this is not a duplicate of the proposal's check: a row
   * outlives the rule that let it in. Another version could have written it, a migration could
   * have added to it, someone could have fixed it by hand in the database, and none of these
   * passed through `ApprovalsService.check`. The same function on both sides means the two halves
   * of the rule cannot diverge.
   */
  private contractOf(action: PendingAction): Contract {
    const preconditions = preconditionsSchema.safeParse(action.preconditions);
    if (!preconditions.success) {
      return { ok: false, reason: 'preconditions are unrecognisable' };
    }

    const effects = effectsSchema.safeParse(action.effects);
    if (!effects.success) {
      return { ok: false, reason: 'effects are unrecognisable' };
    }

    const validity = validateProposal(effects.data, preconditions.data);
    if (!validity.valid) {
      return { ok: false, reason: validity.defects.map(describeDefect).join('; ') };
    }

    return {
      ok: true,
      subject: validity.subject,
      effects: effects.data,
      preconditions: preconditions.data,
    };
  }

  /**
   * Handles a precondition that did not hold. **How** it did not hold decides the fate of the
   * approval (`docs/2-system.md` § “Preconditions and executor”).
   */
  private async abandon(action: PendingAction, verdict: FailedVerdict): Promise<void> {
    const reason = `${verdict.failed.kind} ${verdict.outcome}: ${verdict.detail}`;

    switch (verdict.outcome) {
      // The state changed between the proposal and the approval: the action is no longer the one
      // that was shown. `INV-027`: the model composes a new one and needs the reason.
      case 'broken':
        await this.settle(action.id, 'conflict', reason);

        return;

      // A new proposal of the same shape would hit the same wall, so advising it would mean
      // advising a loop. This is an authoring defect, and it is named in the row.
      case 'undecidable':
        await this.settle(action.id, 'failed', reason, 'other');

        return;

      // We could not inspect the state. This says nothing about the domain, so the person's
      // decision stands, up to the limit (ADR 0044).
      case 'degraded':
        return this.defer(action, verdict.unreachable, reason);
    }
  }
}

/**
 * Classifies a failed write by what it means for the action's fate. Returns `null` when execution
 * does not classify the failure, which then propagates so that it stays visible.
 */
function failureOf(error: unknown): WriteFailure | null {
  // The page does not accept a write that `check` let through: on the same state execution would
  // have let it through too, so the page changed. The state changed between the proposal and the
  // write, so the model composes a new proposal (`INV-027`).
  if (error instanceof UnwritableOnPageError) {
    return { fate: 'conflict', reason: `the page changed after the proposal: ${error.message}` };
  }

  // A value the property does not accept, or a binding that has diverged from the workspace: a
  // retry will not help.
  if (error instanceof UnwritableValueError || error instanceof AdapterConfigurationError) {
    return { fate: 'failed', reason: error.message, failure: 'other' };
  }

  // Notion accepted the write but did not confirm it in its answer: the write has already
  // happened, and a retry would see its own effect as a changed state.
  if (error instanceof UnconfirmedWriteError) {
    return { fate: 'failed', reason: error.message, failure: 'other' };
  }

  // The bot is not yet known: there is no one to write on behalf of, and this says nothing about
  // the domain, so the person's decision stands.
  if (error instanceof BotIdentityUnknownError) {
    return { fate: 'deferred', reason: error.message, unreachable: 'transient' };
  }

  const failure = notionFailureOf(error);

  switch (failure) {
    // The page disappeared between the check and the write: the state changed.
    case 'absent':
      return { fate: 'conflict', reason: `the page is gone: ${messageOf(error)}` };

    // A rate limit, a failure or a lack of access says nothing about the domain, so the person's
    // decision stands, up to the limit (ADR 0044).
    case 'transient':
    case 'no_access':
      return { fate: 'deferred', reason: messageOf(error), unreachable: failure };

    case 'misconfigured':
    case 'unknown':
      return isNotionClientError(error)
        ? { fate: 'failed', reason: `Notion refused the write: ${error.message}`, failure: 'other' }
        : null;
  }
}
