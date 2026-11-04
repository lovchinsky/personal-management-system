import { TELEGRAM_CAPABILITIES } from '../../src/delivery/channels/telegram/telegram.channel';
import { keyboardFor, renderMessage } from '../../src/delivery/channels/telegram/telegram.renderer';
import { NotificationChannel } from '../../src/delivery/port/channel.port';
import { packetFor } from '../../src/delivery/port/packet';
import { textsOf } from '../../src/texts/texts';
import type { ProposalView } from '../gate/gate-claims';
import type { Notice, WrittenComment } from '../gate/m6-evidence';
import { worldOf, type ScenarioId } from '../gate/m6-scenarios';
import type { DeliveredPacket, Evidence8 } from '../gate/m8-evidence';
import type { FixtureKey } from '../gate/m8-fixtures';
import type { NotionRead } from '../gate/run-reads';
import { acted, BOT, idOf, result } from './m6-evidence.fixture';

/**
 * Evidence of the runs of gate M8, without Notion or the model, in exactly the form `m8-claims.ts`
 * sees it. The world's pages have the id `<key>-aaaa-bbbb` (`idOf`); the seeded items have their
 * own.
 */

export const FIXTURE_IDS: Readonly<Record<FixtureKey, string>> = {
  plain: 'plain-fixture-aaaa',
  asked: 'asked-fixture-aaaa',
};

/** The channel gate M8 renders packets through. It has buttons; the fixture needs no delivery. */
const TELEGRAM: NotificationChannel = {
  id: 'telegram',
  capabilities: TELEGRAM_CAPABILITIES,
  excess: () => 0,
  send: () => Promise.resolve({ ok: true }),
};

/** Builds a packet as the person will see it: the same render and `uk` texts as in the gate. */
function packet(notice: Notice, discussionId: string | null = null): DeliveredPacket {
  const { proposals, ...rest } = notice;
  const message = packetFor(TELEGRAM, {
    ...rest,
    ...(proposals === undefined ? {} : { proposals: [...proposals] }),
  });
  const texts = textsOf('uk').telegram;

  return {
    notice,
    discussionId,
    text: renderMessage(message, texts),
    buttons: keyboardFor(message, texts).map((row) => row.map((button) => button.text)),
  };
}

/** Builds a run comment on a page (a world page id or a seeded one) in a thread. */
export function commentOn(pageId: string, text: string, thread: string): WrittenComment {
  return { id: `comment-${thread}-${pageId}`, pageId, discussionId: thread, text, author: BOT };
}

/** Builds a Notion read that returned the world's pages by key. */
export function loaded(keys: readonly string[], tool = 'notion-query-data-sources'): NotionRead {
  return {
    tool,
    mode: tool === 'notion-query-data-sources' ? 'sql' : null,
    at: '2026-10-08T09:00:30.000Z',
    ok: true,
    refused: false,
    metered: tool === 'notion-query-data-sources',
    pages: keys.map(idOf),
    dataSources: [],
  };
}

/** What the gate M8 run did: a packet, comments, proposals, labels and reads. */
interface ReviewActs {
  readonly notice?: Notice;
  readonly discussionId?: string | null;
  readonly comments?: readonly WrittenComment[];
  readonly proposals?: readonly ProposalView[];
  /** Labels: the type and the ids of the pages each one cites. */
  readonly detections?: readonly (readonly [string, readonly string[]])[];
  readonly reads?: readonly NotionRead[];
  readonly newThreads?: readonly string[];
}

/** Builds the evidence of a gate M8 scenario run over its world. */
export function ran(id: ScenarioId, acts: ReviewActs): Evidence8 {
  const notices = acts.notice === undefined ? [] : [acts.notice];
  const detections = acts.detections ?? [];
  const outcome = result([], []);
  const base = acted(
    worldOf(id, '4821-m8-1'),
    { comments: acts.comments, notices, proposals: acts.proposals },
    {
      outcome: detections.length > 0 ? 'attention_raised' : outcome.outcome,
      detections: detections.map(([type, refs]) => ({
        type,
        claim: 'Твердження',
        why_now: 'Тому що',
        evidence: refs.map((ref) => ({ server: 'notion', ref })),
        counterevidence_checked: [],
        uncertainties: [],
      })),
    },
    { reads: acts.reads ?? [loaded([])] },
  );

  return {
    ...base,
    packets: notices.map((notice) => packet(notice, acts.discussionId ?? null)),
    newThreads: acts.newThreads ?? [],
    fixtures: FIXTURE_IDS,
  };
}
