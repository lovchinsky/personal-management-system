import {
  EvaluationWindowStatus,
  McpServerName,
  NotificationDeliveryStatus,
  PendingActionStatus,
  ReasonCode,
  ReviewOccurrenceStatus,
  ScheduledCheckStatus,
  WebhookReceiptStatus,
  WorkflowMode,
} from '../../src/generated/prisma/enums';
import { canonical, LifecycleKey } from './contracts';

/**
 * The lifecycles of the runtime records and their implementation in the schema describe the same
 * sets.
 *
 * The required indexes are checked not here but in the integration lane (`schema-shape.spec.ts`):
 * a grep over the migration text would stay green against a database that has none of them.
 *
 * For the most part this spec checks a mechanism, not an invariant from the registry. The
 * `reason_codes` vocabulary is also the first clause of `INV-019`. The spec catches a `status`
 * field declared without a list of values: a partial index and a scheduler query written against
 * statuses nobody named would fail only on a live database.
 */

describe('canonical lifecycles and the schema enums', () => {
  const pairs: readonly (readonly [LifecycleKey, string, readonly string[]])[] = [
    ['webhook_receipt', 'WebhookReceiptStatus', Object.values(WebhookReceiptStatus)],
    ['scheduled_check', 'ScheduledCheckStatus', Object.values(ScheduledCheckStatus)],
    ['evaluation_window', 'EvaluationWindowStatus', Object.values(EvaluationWindowStatus)],
    [
      'notification_delivery',
      'NotificationDeliveryStatus',
      Object.values(NotificationDeliveryStatus),
    ],
    ['pending_action', 'PendingActionStatus', Object.values(PendingActionStatus)],
    ['review_occurrence', 'ReviewOccurrenceStatus', Object.values(ReviewOccurrenceStatus)],
  ];

  it.each(pairs)('%s matches the enum %s', (key, _enumName, implemented) => {
    expect([...implemented]).toEqual(canonical.lifecycle(key).statuses);
  });

  it.each(pairs)('the terminal statuses of %s are a subset of the declared ones', (key) => {
    const { statuses, terminal } = canonical.lifecycle(key);

    expect(statuses).toEqual(expect.arrayContaining([...terminal]));
  });

  /** `INV-019`: a wake reason comes only from the `reason_codes` vocabulary. */
  it('the reason_codes vocabulary matches the ReasonCode enum', () => {
    expect(Object.values(ReasonCode)).toEqual(canonical.reasonCodes());
  });

  it('the workflow_modes list matches the WorkflowMode enum', () => {
    const declared = Object.keys(canonical.workflowModes());

    expect(Object.values(WorkflowMode)).toEqual(declared);
  });

  /**
   * The same enum is the type of both the run perimeter and the server of a call in the trace
   * (`run_tool_calls`), so a server the contract does not know cannot appear in either. The
   * contract has its own order, so the set is compared.
   */
  it('the mcp_toolsets servers match the McpServerName enum', () => {
    const declared = Object.keys(canonical.mcpToolsets());

    expect([...Object.values(McpServerName)].sort()).toEqual([...declared].sort());
  });
});
