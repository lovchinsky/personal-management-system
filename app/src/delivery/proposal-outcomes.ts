import type { ProposalFate } from '../approvals/proposal-notice';
import type { PendingActionStatus } from '../generated/prisma/enums';
import type { Texts } from '../texts/texts';

/**
 * Returns the fates of a message's proposals worded as the channel shows them: what delivery
 * appends next to a proposal once its fate is known. The words come from the catalog of the
 * installation's language (`Texts.outcomes`), and each one fits into the reserve the renderer
 * leaves for a proposal (`OUTCOME_UNITS`, `INV-106`).
 */
export function outcomesOf(
  fates: ReadonlyMap<string, PendingActionStatus>,
  outcomes: Texts['outcomes'],
): ReadonlyMap<string, string> {
  const isFate = (status: PendingActionStatus): status is ProposalFate =>
    Object.hasOwn(outcomes, status);

  return new Map(
    [...fates].flatMap(([id, fate]): [string, string][] =>
      isFate(fate) ? [[id, outcomes[fate]]] : [],
    ),
  );
}
