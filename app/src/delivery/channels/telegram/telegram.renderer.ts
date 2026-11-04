import { escapeHtml } from '../../../telegram/telegram-html';
import { InlineButton } from '../../../telegram/telegram.client';
import type { TelegramTexts } from '../../../texts/texts';
import { ChannelAction, MAX_MORE_PROPOSALS, OutboundMessage } from '../../port/channel.port';
import { callbackDataOf } from './callback-data';

/** Telegram's limit on message text, in UTF-16 code units. */
export const MAX_TEXT_UNITS = 4096;

/** How many units are reserved for the fate of each proposal in the packet. */
export const OUTCOME_UNITS = 120;

/**
 * The longest link caption the proof below rests on. A catalog with a longer caption breaks the
 * proof, so `INV-106` enforces the limit for every catalog.
 */
export const LINK_LABEL_UNITS = 40;

const ELLIPSIS = '…\n\n';

/**
 * The promise “the result is not longer than the limit” is a theorem, not a hope.
 *
 * The fixed part — the proposals, the ask and the link — is never shortened, because without it
 * the message stops being a decision. The renderer reserves `OUTCOME_UNITS` in advance for the
 * fate of each proposal, so a message rewritten with fates fits too, and the packet's body does
 * not change from edit to edit. The renderer also reserves `moreUnitsOf` for the line about the
 * remaining proposals: the App appends the number to that line when it queues the packet, and a
 * packet that fit at the check fits with the number too.
 *
 * Without proposals the port schema guarantees the theorem. The tail's markup costs 23 units
 * (`<b></b>`, `\n`, `<a href="">`, `</a>`), the link caption at most `LINK_LABEL_UNITS` once
 * escaped, and the ellipsis with its blank line 3 more. Escaping lengthens the worst case
 * sixfold (`"` → `&quot;`). The ask and the link are 300 units each, so the worst tail is
 * 6 × 600 + 23 + 40 + 3 = 3666, which leaves more than 400 units of room below the limit even
 * when the text consists of nothing but quotation marks.
 *
 * With proposals the schema does not keep the worst case within the limit, so `excessOf` measures
 * it when a packet enters the queue, together with `noticed` and `why_it_matters`. A packet that
 * does not fit with room for the fates is never queued. A row written by a version with wider
 * limits fails the schema at delivery, and the worker retires it as `unrecognised payload`,
 * without spending eight attempts on what will never arrive.
 */

/**
 * An intent sign for buttons that show a proposal number. It has no words, so it is the same in
 * every language.
 */
const SIGNS: Record<ChannelAction['kind'], string> = {
  approve: '✓',
  reject: '✕',
  snooze: '⏱',
  dismiss: '—',
};

/** No fates: the message is as it was sent. */
const UNSETTLED: ReadonlyMap<string, string> = new Map();

/**
 * Builds the packet's keyboard: a row of buttons for each proposal that still awaits a decision,
 * in the order of the proposals. The App numbers the buttons of several proposals, as it numbers
 * their lines. The buttons of a settled proposal disappear and the rest stay.
 *
 * A button holds only the intent and the proposal id, because `callback_data` is limited to 64
 * bytes and cannot hold effects with their values. The executor reads the row again and
 * revalidates the preconditions. A button is the transport of an intent, not its content.
 */
export function keyboardFor(
  message: OutboundMessage,
  texts: TelegramTexts,
  settled: ReadonlyMap<string, string> = UNSETTLED,
): readonly (readonly InlineButton[])[] {
  const proposals = message.proposals ?? [];
  const actions = message.actions ?? [];
  const numbered = proposals.length > 1;

  return proposals.flatMap((proposal, index) => {
    if (settled.has(proposal.pendingActionId)) return [];

    const row = actions
      .filter((action) => action.pendingActionId === proposal.pendingActionId)
      .map((action) => ({
        text: numbered ? `${index + 1} ${SIGNS[action.kind]}` : texts.buttons[action.kind],
        callback_data: callbackDataOf(action),
      }));

    return row.length > 0 ? [row] : [];
  });
}

/** Renders the fate of a proposal for display beside its line. */
export function outcomeMark(outcome: string): string {
  return ` — <i>${escapeHtml(outcome)}</i>`;
}

/**
 * Renders the fixed part: the numbered proposal lines with the fates of the settled ones, the line
 * about the rest, the ask and the link.
 */
function fixedPart(
  message: OutboundMessage,
  settled: ReadonlyMap<string, string>,
  texts: TelegramTexts,
): string {
  const lines = (message.proposals ?? []).map((proposal, index) => {
    const outcome = settled.get(proposal.pendingActionId);
    const mark = outcome === undefined ? '' : outcomeMark(outcome);

    return `${index + 1}. ${escapeHtml(proposal.line)}${mark}`;
  });

  if (message.moreProposals !== undefined) {
    lines.push(escapeHtml(texts.moreWaiting(message.moreProposals)));
  }

  const tail = `<b>${escapeHtml(message.ask)}</b>\n<a href="${escapeHtml(message.link)}">${escapeHtml(texts.openInNotion)}</a>`;

  return lines.length === 0 ? tail : `${lines.join('\n')}\n\n${tail}`;
}

/** Measures the longest line about the rest, escaped, with the line break before it. */
function moreUnitsOf(texts: TelegramTexts): number {
  return escapeHtml(texts.moreWaiting(MAX_MORE_PROPOSALS)).length + 1;
}

/**
 * Computes the reserve for the fixed part: room for the fate of each proposal in the packet and,
 * when there are proposals, for the line about the rest. The App appends the number to that line
 * when it queues the packet.
 */
function reserveOf(message: OutboundMessage, texts: TelegramTexts): number {
  const proposals = message.proposals?.length ?? 0;

  return proposals * OUTCOME_UNITS + (proposals > 0 ? moreUnitsOf(texts) : 0);
}

/**
 * Measures the fixed part without the line about the rest. A reserve covers that line, so the
 * measure does not depend on it.
 */
function measuredPart(message: OutboundMessage, texts: TelegramTexts): number {
  return fixedPart({ ...message, moreProposals: undefined }, UNSETTLED, texts).length;
}

/**
 * Returns by how many units the packet is longer than a message; 0 means it fits. What is
 * measured is what the person must read whole: the fixed part with room for the fates and the
 * line about the rest, `noticed` and `why_it_matters`. The renderer drops `context` and `prepared`
 * itself when they lack room. Measuring uses the same texts as rendering: otherwise a packet that
 * fit when it entered the queue would not fit at delivery.
 */
export function excessOf(
  message: OutboundMessage,
  texts: TelegramTexts,
  limit = MAX_TEXT_UNITS,
): number {
  const body = escapeHtml(`${message.noticed}\n\n${message.whyItMatters}`).length + 2;

  return Math.max(0, measuredPart(message, texts) + reserveOf(message, texts) + body - limit);
}

/**
 * Renders a decision packet in Telegram's HTML subset; `settled` holds the fates of the settled
 * proposals.
 *
 * Shortening happens **on the context side**: the proposals, the ask and the link are always
 * kept, because without them the message stops being a decision and becomes noise. A packet is
 * never split into several messages, because the buttons belong to one message.
 */
export function renderMessage(
  message: OutboundMessage,
  texts: TelegramTexts,
  settled: ReadonlyMap<string, string> = UNSETTLED,
  limit = MAX_TEXT_UNITS,
): string {
  const tail = fixedPart(message, settled, texts);
  // The body is measured against the fixed part without fates and the full reserve for them: that
  // way it is the same in the sent message and in each rewrite of it.
  const room = limit - measuredPart(message, texts) - reserveOf(message, texts);

  // Drop order: the longest and least essential goes first.
  const optional: readonly (string | undefined)[] = [message.context, message.prepared];

  for (let keep = optional.length; keep >= 0; keep -= 1) {
    const body = [
      message.noticed,
      message.whyItMatters,
      ...optional.slice(0, keep).filter((part): part is string => Boolean(part)),
    ]
      .map(escapeHtml)
      .join('\n\n');

    if (body.length + 2 <= room) {
      return `${body}\n\n${tail}`;
    }
  }

  // Even without the context the message does not fit, which happens only with a row written by a
  // version with wider limits. The longest of what is left is cut, and the fixed part arrives
  // whole.
  const head = fitEscaped(`${message.noticed}\n\n${message.whyItMatters}`, room - ELLIPSIS.length);

  return `${head}${ELLIPSIS}${tail}`;
}

/**
 * Escapes the longest prefix of the raw text whose **escaped** form fits the budget.
 *
 * Two requirements. Only the raw text may be cut: a cut entity (`&am`) is no longer markup, and a
 * cut surrogate pair is no longer a character, and Telegram rejects both. The input is
 * deterministic, so all eight attempts burn on it the same way and the nudge is lost. What must
 * be measured, though, is the finished string: escaping lengthens the text, and a fixed reserve
 * does not vouch for it.
 *
 * The walk runs over code points, so a surrogate pair is never split in half **by construction**,
 * not by a check. A whole escaped unit is always added, so an entity is never split either.
 */
function fitEscaped(raw: string, budget: number): string {
  if (budget <= 0) return '';

  let end = 0;
  let length = 0;

  for (const character of raw) {
    const escaped = escapeHtml(character).length;

    if (length + escaped > budget) break;

    end += character.length;
    length += escaped;
  }

  return escapeHtml(raw.slice(0, end));
}
