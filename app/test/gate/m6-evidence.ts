import { z } from 'zod';
import type { AttemptView } from '../../src/claude/runner/run-tap';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { HarnessError } from './gate-attempts';
import { pageIdOf, sameId, type Evidence } from './gate-claims';
import type { ContinuationState } from './m4-claims';
import type { MemoryEvidence } from './memory-evidence';
import type { NotionRead } from './run-reads';

/** A notification packet as the run queued it: what was noticed, why now, what is needed. */
export interface Notice {
  readonly noticed: string;
  readonly whyItMatters: string;
  readonly ask: string;
  /** A link to the object: artifacts include the id, the text for the person does not. */
  readonly link: string;
  /** Context and the prepared part are optional parts of the packet, also text for the person. */
  readonly context?: string;
  readonly prepared?: string;
  /**
   * The packet's proposals: the id and the line of each. The App adds the “approve” and “reject”
   * buttons to each one itself, so a proposal outside this field is one that cannot be decided
   * from the notification.
   */
  readonly proposals?: readonly { readonly pendingActionId: string; readonly line: string }[];
}

const noticeSchema = z.looseObject({
  noticed: z.string(),
  whyItMatters: z.string(),
  ask: z.string(),
  link: z.string(),
  context: z.string().optional(),
  prepared: z.string().optional(),
  proposals: z.array(z.looseObject({ pendingActionId: z.string(), line: z.string() })).optional(),
});

/**
 * Parses a packet from the payload of a queue row. A shape the gate cannot parse is drift of the
 * delivery format, not “the run said nothing”, because a silently empty packet would switch off the
 * text checks that depend on it.
 */
export function noticeFrom(payload: unknown): Notice {
  const parsed = noticeSchema.safeParse(payload);

  if (!parsed.success) {
    throw new HarnessError(
      `the notification payload does not parse: ${z.prettifyError(parsed.error)}`,
    );
  }

  const { noticed, whyItMatters, ask, link, context, prepared, proposals } = parsed.data;

  return {
    noticed,
    whyItMatters,
    ask,
    link,
    ...(context === undefined ? {} : { context }),
    ...(prepared === undefined ? {} : { prepared }),
    ...(proposals === undefined
      ? {}
      : { proposals: proposals.map(({ pendingActionId, line }) => ({ pendingActionId, line })) }),
  };
}

/**
 * A comment the run wrote: the page and thread come from the comment itself in Notion, not from
 * the selection of the world's pages, so a write outside the world is visible too.
 */
export interface WrittenComment {
  readonly id: string;
  readonly pageId: string;
  readonly discussionId: string;
  readonly text: string;
  readonly author: string;
}

/** A continuation the run scheduled: a queue row with its id, the page and the thread it wakes. */
export interface WrittenContinuation extends ContinuationState {
  readonly id: string;
  readonly pageId: string;
  readonly discussionId: string | null;
}

/** What the run told the person: comments and notification packets, from its run trace effects. */
interface Written {
  readonly comments: readonly WrittenComment[];
  readonly notices: readonly Notice[];
  /**
   * The length of each packet in the channel, in the App's language. The world measures it, because
   * the App knows the language (`packet-length.ts`).
   */
  readonly packetLengths: readonly number[];
}

/**
 * Evidence of one gate M6 run. `continuations` are those this run scheduled (by its effects), not
 * everything that sits on the thread. `foreign` are writes that landed outside the pages of
 * the scenario's world: foreign data the gate did not create. `discussionId` is the thread in
 * which the person replied; `null` means the run did not come from a reply.
 */
export interface Evidence6 extends Evidence {
  readonly continuations: readonly WrittenContinuation[];
  readonly written: Written;
  readonly foreign: readonly string[];
  readonly discussionId: string | null;
  /**
   * What the runner reported about the run: Skill files read, reasons the result was rejected, and
   * GBrain calls.
   */
  readonly observed: AttemptView;
  /** What the run read in Notion, from the attempt stream: calls, quota, returned pages. */
  readonly reads: readonly NotionRead[];
  /** The scenario's GBrain pages before the run and after it, and the GBrain calls of this run. */
  readonly memory: MemoryEvidence;
}

/** Nothing reported: a run with no entry in the collector (deferred, never reached the runner). */
export const NOT_OBSERVED: AttemptView = {
  skillReads: [],
  rejections: [],
  gbrainCalls: [],
  transcript: [],
};

/**
 * Reports, for each proposal of this run, whether the `proposals` field of any of its notification
 * packets includes it. A proposal outside a packet is one the person cannot decide from the
 * notification.
 */
export function offeredProposals(
  evidence: Evidence6,
): { readonly proposal: string; readonly offered: boolean }[] {
  const offered = (id: string): boolean =>
    evidence.written.notices.some((notice) =>
      (notice.proposals ?? []).some(
        (carried) => carried.pendingActionId.toLowerCase() === id.toLowerCase(),
      ),
    );

  return evidence.proposals.map((proposal) => ({
    proposal: proposal.id,
    offered: offered(proposal.id),
  }));
}

/** Returns the comments the run wrote on a world page, given its key. */
export function commentsOn(evidence: Evidence6, key: string): WrittenComment[] {
  const id = pageIdOf(evidence, key);

  return evidence.written.comments.filter((comment) => sameId(comment.pageId, id));
}

/**
 * Returns the run's comments on a page in the thread where the person replied: the reply is there.
 */
export function inThread(evidence: Evidence6, key: string): WrittenComment[] {
  const thread = evidence.discussionId;

  if (thread === null) return [];

  return commentsOn(evidence, key).filter(
    (comment) => canonicalNotionId(comment.discussionId) === canonicalNotionId(thread),
  );
}

/** Returns the text of a notification packet that the person reads (the link is not part of it). */
function wordsOf(notice: Notice): string[] {
  return [
    notice.noticed,
    notice.whyItMatters,
    notice.ask,
    ...(notice.context === undefined ? [] : [notice.context]),
    ...(notice.prepared === undefined ? [] : [notice.prepared]),
  ];
}

/**
 * Returns everything the run wrote to the person: comments on any pages and notification packets.
 */
export function textsOf(evidence: Evidence6): string[] {
  return [
    ...evidence.written.comments.map((comment) => comment.text),
    ...evidence.written.notices.flatMap(wordsOf),
  ];
}

/**
 * Finds the continuation a recheck must wake: scheduled by this run, of the class that wakes, and
 * on a world page. A continuation on a foreign page must not be woken, because the run would
 * operate on the owner's real data and the gate would conclude its row as its own.
 */
export function wakeOf(
  evidence: Evidence6,
  worldPages: readonly string[],
  wakeReasons: readonly string[],
): WrittenContinuation | undefined {
  const own = new Set(worldPages.map(canonicalNotionId));

  return evidence.continuations.find(
    (row) => wakeReasons.includes(row.reasonCode) && own.has(canonicalNotionId(row.pageId)),
  );
}
