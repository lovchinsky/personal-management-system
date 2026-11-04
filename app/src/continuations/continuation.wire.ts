import { z } from 'zod';
import { ScheduledCheck } from '../generated/prisma/client';
import { ReasonCode, ScheduledCheckStatus } from '../generated/prisma/enums';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { Continuation, ContinuationQuery, ContinuationRequest } from './continuation.schema';

/**
 * A continuation request on the App MCP wire (`schedule_continuation`, `reschedule_continuation`):
 * the field names are as in the envelope, the time is an ISO 8601 string with a zone
 * (`docs/2-system.md` § “App MCP”).
 *
 * This schema describes only the shape. The rules — who may name `user_snooze`, whose snooze must
 * not be moved — are checked by the service, using the same schema as for any other input.
 */
export const continuationWireSchema = z.strictObject({
  discussion_id: z.string().min(1).optional(),
  page_id: z.string().min(1),
  run_at: z.iso.datetime({ offset: true }),
  /**
   * The reasons named by a step that requests a continuation. The App sets
   * `resolution_reconciliation` when it finds a thread resolved, so it is not among the options.
   */
  reason_code: z.enum(ReasonCode).exclude(['resolution_reconciliation']),
});

export type ContinuationWire = z.infer<typeof continuationWireSchema>;

export function continuationRequestOf(wire: ContinuationWire): ContinuationRequest {
  return {
    discussionId: wire.discussion_id,
    notionPageId: wire.page_id,
    runAt: new Date(wire.run_at),
    reasonCode: wire.reason_code,
  };
}

/**
 * What a state question is about (`get_continuation_state`): a thread, or a page, possibly with a
 * reason. A thread addresses itself; a page without a thread does so through the reason, because
 * without a thread there can be several continuations on it.
 */
export const continuationQueryWireSchema = z.strictObject({
  discussion_id: z.string().min(1).optional(),
  page_id: z.string().min(1).optional(),
  /** The model does not see closure, so there is nothing to ask about by its reason. */
  reason_code: z.enum(ReasonCode).exclude(['resolution_reconciliation']).optional(),
});

export type ContinuationQueryWire = z.infer<typeof continuationQueryWireSchema>;

/**
 * Converts the question from the wire into the shape the service accepts. The wire schema cannot
 * say “exactly one of the two” — a tool's input must be an object — so the refusal comes from the
 * conversion. The reason narrows only a question about a page: a thread addresses itself.
 */
export function continuationQueryOf(wire: ContinuationQueryWire): ContinuationQuery {
  if (wire.discussion_id !== undefined && wire.page_id === undefined) {
    return { discussionId: wire.discussion_id };
  }

  if (wire.page_id !== undefined && wire.discussion_id === undefined) {
    return { notionPageId: wire.page_id, reasonCode: wire.reason_code };
  }

  throw new InvalidRequestError('continuation state: name either a discussion_id or a page_id');
}

/**
 * An open continuation as the model sees it: thread, page, reason, time and status. Queue
 * bookkeeping — attempts, lease, version — is not part of it (`INV-030`).
 *
 * `staged` is a continuation this run has written and that will be applied at the end: it is shown
 * in the same form as a queue row.
 */
export interface ContinuationStateWire {
  readonly discussion_id?: string;
  readonly page_id: string;
  readonly reason_code: ReasonCode;
  readonly run_at: string;
  readonly status: ScheduledCheckStatus | 'staged';
}

/**
 * The state response: open continuations, soonest first. `truncated` is present only when there
 * are more open ones than the limit allows, because the model would read silent truncation as
 * “there are no more”.
 */
export interface ContinuationStatesWire {
  readonly continuations: readonly ContinuationStateWire[];
  readonly truncated?: true;
}

function continuationViewOf(
  continuation: Continuation,
  status: ContinuationStateWire['status'],
): ContinuationStateWire {
  return {
    ...(continuation.discussionId ? { discussion_id: continuation.discussionId } : {}),
    page_id: continuation.notionPageId,
    reason_code: continuation.reasonCode,
    run_at: continuation.runAt.toISOString(),
    status,
  };
}

export function continuationStateOf(row: ScheduledCheck): ContinuationStateWire {
  return continuationViewOf(
    {
      discussionId: row.discussionId ?? undefined,
      notionPageId: row.notionPageId,
      runAt: row.runAt,
      reasonCode: row.reasonCode,
    },
    row.status,
  );
}

/** A continuation written by a run is not yet a queue row. */
export function stagedContinuationOf(request: Continuation): ContinuationStateWire {
  return continuationViewOf(request, 'staged');
}
