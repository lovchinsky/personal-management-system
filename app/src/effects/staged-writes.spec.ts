import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NOTICED } from '../../test/fixtures/actors';
import { Proposal, ProposalRequest, proposalSchema } from '../approvals/proposal.schema';
import { CommentRequest, commentSchema } from '../attention/comment.schema';
import { inboxClosureSchema } from '../capture/inbox-closure.schema';
import { InboxConversionRequest, inboxConversionSchema } from '../capture/inbox-conversion.schema';
import { inboxParkingSchema } from '../capture/inbox-parking.schema';
import { Continuation, ContinuationRequest } from '../continuations/continuation.schema';
import { DeliveryRequest } from '../delivery/delivery.schema';
import { MemoryEntryRequest, memoryEntrySchema } from '../memory/memory-entry.schema';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { AppliedEffect, EffectsReport } from '../runs/run-effects';
import { StagedWrites } from './staged-writes';
import { WriteKind, WriteOwners } from './write-kinds';

const CONTINUATION: ContinuationRequest = {
  notionPageId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
  runAt: new Date('2026-09-30T09:00:00.000Z'),
  reasonCode: 'safety_recheck',
};

const PROPOSAL: ProposalRequest = {
  effects: [
    {
      kind: 'property_write',
      pageId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
      propertyId: 'p_task_status',
      value: { kind: 'option', option: 'Done' },
    },
  ],
  preconditions: [
    {
      kind: 'property_equals',
      pageId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
      propertyId: 'p_task_status',
      optionId: 'opt-next',
    },
  ],
};

/** The real id a proposal gets when it is applied. */
const PROPOSAL_ROW = '01999999-0000-7000-8000-000000000001';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';

/** A comment that opens a thread on a page. */
const OPENING: CommentRequest = { pageId: PAGE, text: 'Задача чекає на відповідь постачальника' };

/** The real thread a comment gets when it is applied. */
const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

const INBOX_ITEM = '3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e';

/** The Task a conversion gets when it is applied. */
const TASK = '4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f';

const CONVERSION: InboxConversionRequest = {
  inboxPageId: INBOX_ITEM,
  task: { name: 'Подзвонити в банк', status: 'Next Action' },
  comment: 'Стало задачею',
};

/** A decision of the person that the run writes to memory on the project's anchor. */
const DECISION: MemoryEntryRequest = {
  objectId: PAGE,
  kind: 'decision',
  text: 'Беремо постачальника Б',
  date: '2026-09-30',
  sourcePageId: PAGE,
};

/** The slug of the anchor the memory write landed on. */
const ANCHOR = 'projects/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b';

/** The run's deadline is still ahead. */
const RUNNING: AbortSignal = new AbortController().signal;

/** The reason the run's deadline fires with. */
const DEADLINE_REACHED = 'the run reached its deadline';

/** The effects of a conversion that completed in full: the Task, the origin comment, the trash. */
const CONVERTED: AppliedEffect[] = [
  { kind: 'page_created', id: TASK },
  { kind: 'comment', id: 'origin-comment' },
  { kind: 'page_archived', id: INBOX_ITEM },
];

function notification(key: string, pendingActionId?: string): DeliveryRequest {
  return {
    idempotencyKey: key,
    channel: 'telegram',
    message: {
      noticed: 'Задача чекає на відповідь постачальника',
      whyItMatters: 'Вона блокує єдиний критичний шлях проєкту',
      ask: 'Позначити як виконану?',
      link: 'https://www.notion.so/page-1',
      ...(pendingActionId ? { proposals: [{ pendingActionId, line: 'Закрити задачу' }] } : {}),
    },
  };
}

/**
 * Owners that only record what reached them. The test changes the state of the world itself:
 * `refusing` is a kind the owner rejects, `failing` is a kind whose applying fails.
 */
class World {
  readonly log: string[] = [];
  readonly refusing = new Set<WriteKind>();
  readonly failing = new Set<WriteKind>();
  /** The ids that delivery buttons ended up with during applying. */
  readonly buttons: string[] = [];
  /** The threads that replies and continuations ended up in during applying. */
  readonly threads: string[] = [];
  /** The pages that comments and continuations ended up on during applying. */
  readonly pages: string[] = [];
  /** The conversion stops after its first step. */
  stopping = false;
  /**
   * A memory write waits for an external system until the run's deadline cuts the wait short; the
   * function is called as soon as the wait has started.
   */
  waiting: (() => void) | null = null;

  readonly owners: WriteOwners = {
    memory_entry: {
      check: (_context, request) => this.checked('memory_entry', memoryEntrySchema.parse(request)),
      apply: (_context, _write, _refs, applied, deadline) => {
        this.log.push('apply memory_entry');

        if (this.waiting !== null && deadline !== undefined) {
          const aborted = new Promise<string>((_resolve, reject) => {
            deadline.addEventListener('abort', () => reject(new Error(DEADLINE_REACHED)), {
              once: true,
            });
          });

          this.waiting();

          return aborted;
        }

        if (this.failing.has('memory_entry')) {
          return Promise.reject(new Error('memory cannot be reached'));
        }

        applied({ kind: 'memory_entry', id: ANCHOR });

        return Promise.resolve(ANCHOR);
      },
    },
    inbox_item: {
      mints: 'page',
      check: (_context, request) => this.checked('inbox_item', inboxParkingSchema.parse(request)),
      apply: (_context, _write, _refs, applied) => {
        this.log.push('apply inbox_item');
        applied({ kind: 'page_created', id: INBOX_ITEM });

        return Promise.resolve(INBOX_ITEM);
      },
    },
    inbox_closure: {
      check: (_context, request) =>
        this.checked('inbox_closure', inboxClosureSchema.parse(request)),
      apply: (_context, _write, _refs, applied) => {
        this.log.push('apply inbox_closure');
        applied({ kind: 'comment', id: 'closure-comment' });
        applied({ kind: 'page_archived', id: INBOX_ITEM });

        return Promise.resolve(INBOX_ITEM);
      },
    },
    inbox_conversion: {
      mints: 'page',
      check: (_context, request) =>
        this.checked('inbox_conversion', inboxConversionSchema.parse(request)),
      apply: (_context, _write, _refs, applied) => {
        this.log.push('apply inbox_conversion');

        if (this.stopping) {
          for (const effect of CONVERTED.slice(0, 1)) applied(effect);

          return Promise.reject(new Error('comment refused'));
        }

        for (const effect of CONVERTED) applied(effect);

        return Promise.resolve(TASK);
      },
    },
    comment: {
      mints: 'discussion',
      check: (_context, request) => this.checked('comment', commentSchema.parse(request)),
      apply: (_context, comment, refs, applied) => {
        const thread = comment.discussionId && refs.resolve('discussion', comment.discussionId);

        this.pages.push(refs.resolve('page', comment.pageId));

        if (thread) this.threads.push(thread);

        return this.written('comment', 'comment-row', applied, thread || THREAD);
      },
    },
    continuation: {
      check: (_context, request) => this.checked('continuation', request),
      apply: (_context, request, refs, applied) => {
        this.pages.push(refs.resolve('page', request.notionPageId));

        if (request.discussionId) {
          this.threads.push(refs.resolve('discussion', request.discussionId));
        }

        return this.written('continuation', 'continuation-row', applied);
      },
    },
    proposal: {
      mints: 'proposal',
      check: (_context, request) => this.checked('proposal', proposalSchema.parse(request)),
      apply: (_context, _request, _refs, applied) =>
        this.written('proposal', PROPOSAL_ROW, applied),
    },
    delivery: {
      check: (_context, request, refs) => {
        const unknown = (request.message.proposals ?? []).find(
          (proposal) => !refs.minted('proposal', proposal.pendingActionId),
        );

        if (unknown) {
          return Promise.reject(new InvalidRequestError('delivery: no such proposal'));
        }

        return this.checked('delivery', request);
      },
      apply: (_context, request, refs, applied) => {
        for (const proposal of request.message.proposals ?? []) {
          this.buttons.push(refs.resolve('proposal', proposal.pendingActionId));
        }

        return this.written('delivery', 'delivery-row', applied);
      },
    },
  };

  private checked<T>(kind: WriteKind, write: T): Promise<T> {
    this.log.push(`check ${kind}`);

    return this.refusing.has(kind)
      ? Promise.reject(new InvalidRequestError(`${kind}: refused on recheck`))
      : Promise.resolve(write);
  }

  /** Applies a write of one effect, given its id and, if that differs, the real id. */
  private written(
    kind: Exclude<WriteKind, 'inbox_item' | 'inbox_conversion' | 'inbox_closure'>,
    id: string,
    applied: (effect: AppliedEffect) => void,
    real: string = id,
  ): Promise<string> {
    this.log.push(`apply ${kind}`);

    if (this.failing.has(kind)) return Promise.reject(new Error(`${kind}: failed to apply`));

    applied({ kind, id });

    return Promise.resolve(real);
  }
}

describe('the deferred write policy', () => {
  it('what was staged waits for the conclusion and is applied in the order of kinds', async () => {
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

    await writes.submit('delivery', notification('nudge-1'));
    await writes.submit('proposal', PROPOSAL);
    await writes.submit('continuation', CONTINUATION);
    await writes.submit('comment', OPENING);

    expect(world.log.filter((step) => step.startsWith('apply'))).toEqual([]);

    const report = await writes.commit();
    const expected: EffectsReport = {
      applied: [
        { kind: 'comment', id: 'comment-row' },
        { kind: 'continuation', id: 'continuation-row' },
        { kind: 'proposal', id: PROPOSAL_ROW },
        { kind: 'delivery', id: 'delivery-row' },
      ],
      refused: [],
    };

    expect(report).toEqual(expected);
  });

  it('a memory write is applied first, and its failure leaves the rest unapplied', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

    await writes.submit('comment', OPENING);
    await writes.submit('memory_entry', DECISION);

    const applied = await writes.commit();

    expect(applied.applied).toEqual([
      { kind: 'memory_entry', id: ANCHOR },
      { kind: 'comment', id: 'comment-row' },
    ]);

    const failed = new World();
    const failing = new StagedWrites(NOTICED, failed.owners, RUNNING);

    failed.failing.add('memory_entry');
    await failing.submit('comment', OPENING);
    await failing.submit('memory_entry', DECISION);

    const report = await failing.commit();

    expect(report.applied).toEqual([]);
    expect(report.failure).toBe('memory cannot be reached');
    expect(failed.log).not.toContain('apply comment');
    logged.mockRestore();
  });

  /**
   * Applying does not begin until everything that was staged has passed the recheck: state that
   * changed during the run stops everything before the first write.
   */
  it('the recheck stops applying before the first write', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

    await writes.submit('continuation', CONTINUATION);
    await writes.submit('delivery', notification('nudge-2'));
    world.refusing.add('delivery');

    const report = await writes.commit();

    expect(report.applied).toEqual([]);
    expect(report.failure).toBe('delivery: refused on recheck');
    expect(world.log.filter((step) => step.startsWith('apply'))).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
  });

  /**
   * The trace sees the reason, and the stack stays for whoever fixes the error: the log writes the
   * stack.
   */
  it('a refusal while applying stops the rest, and what was applied stays', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

    await writes.submit('continuation', CONTINUATION);
    await writes.submit('proposal', PROPOSAL);
    await writes.submit('delivery', notification('nudge-3'));
    world.failing.add('proposal');

    const report = await writes.commit();
    const prefix: AppliedEffect[] = [{ kind: 'continuation', id: 'continuation-row' }];

    expect(report.applied).toEqual(prefix);
    expect(report.failure).toBe('proposal: failed to apply');
    expect(world.log).not.toContain('apply delivery');
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('proposal: failed to apply'),
      expect.stringContaining('Error: proposal: failed to apply'),
    );
  });

  describe('temporary references', () => {
    it("a button for this run's proposal gets its real id", async () => {
      const world = new World();
      const writes = new StagedWrites(NOTICED, world.owners, RUNNING);
      const { ref } = await writes.submit('proposal', PROPOSAL);

      await writes.submit('delivery', notification('nudge-4', ref));
      await writes.commit();

      expect(world.buttons).toEqual([PROPOSAL_ROW]);
    });

    /** Only a kind that mints references mints one: a continuation does not become a proposal. */
    it('only a write of a kind that mints references mints one', async () => {
      const world = new World();
      const writes = new StagedWrites(NOTICED, world.owners, RUNNING);
      const proposal = await writes.submit('proposal', PROPOSAL);
      const continuation = await writes.submit('continuation', CONTINUATION);

      expect(writes.minted('proposal', proposal.ref)).toBe(true);
      expect(writes.minted('proposal', continuation.ref)).toBe(false);
      expect(writes.minted('proposal', randomUUID())).toBe(false);
      await expect(
        writes.submit('delivery', notification('nudge-5', continuation.ref)),
      ).rejects.toThrow(InvalidRequestError);
    });

    /**
     * A comment is applied first, so a continuation and a reply that point to the thread it opened
     * get its real id.
     */
    it('the thread a comment opened gets its real id in a continuation and a reply', async () => {
      const world = new World();
      const writes = new StagedWrites(NOTICED, world.owners, RUNNING);
      const foreign = randomUUID();

      await writes.submit('continuation', { ...CONTINUATION, discussionId: foreign });

      const opened = await writes.submit('comment', OPENING);

      await writes.submit('continuation', { ...CONTINUATION, discussionId: opened.ref });
      await writes.submit('comment', { ...OPENING, discussionId: opened.ref });
      await writes.commit();

      // Comments are applied first: the reply, then both continuations in the order they were
      // written.
      expect(world.threads).toEqual([THREAD, foreign, THREAD]);
      expect(writes.minted('discussion', opened.ref)).toBe(true);
      expect(writes.minted('proposal', opened.ref)).toBe(false);
    });

    /**
     * A conversion is applied first: a comment and a continuation that point to the Task it will
     * create get the Task's real id.
     */
    it('the Task of a conversion gets its real id in a comment and a continuation', async () => {
      const world = new World();
      const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

      await writes.submit('continuation', CONTINUATION);

      const converted = await writes.submit('inbox_conversion', CONVERSION);

      await writes.submit('comment', { ...OPENING, pageId: converted.ref });
      await writes.submit('continuation', { ...CONTINUATION, notionPageId: converted.ref });

      const report = await writes.commit();

      expect(report.applied.slice(0, 3)).toEqual(CONVERTED);
      expect(world.pages).toEqual([TASK, CONTINUATION.notionPageId, TASK]);
      expect(writes.minted('page', converted.ref)).toBe(true);
    });

    /**
     * A write to Notion cannot be undone: the conversion steps that completed before the failure
     * stay, and the trace must see them.
     */
    it('a conversion stopped midway leaves its completed steps in the applied list', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const world = new World();
      const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

      await writes.submit('inbox_conversion', CONVERSION);
      await writes.submit('delivery', notification('after-conversion'));
      world.stopping = true;

      const report = await writes.commit();

      expect(report.applied).toEqual(CONVERTED.slice(0, 1));
      expect(report.failure).toBe('comment refused');
      expect(world.log).not.toContain('apply delivery');
    });

    it('a foreign reference resolves to itself, a minted one to a real id only after applying', async () => {
      const world = new World();
      const writes = new StagedWrites(NOTICED, world.owners, RUNNING);
      const { ref } = await writes.submit('proposal', PROPOSAL);
      const foreign = randomUUID();

      expect(writes.resolve('proposal', foreign)).toBe(foreign);
      expect(() => writes.resolve('proposal', ref)).toThrow('before the write that minted it');

      await writes.commit();

      expect(writes.resolve('proposal', ref)).toBe(PROPOSAL_ROW);
    });
  });

  it('capability reads see what was staged of one kind in the order it was written', async () => {
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);
    const later: ContinuationRequest = { ...CONTINUATION, runAt: new Date('2026-10-01T09:00:00Z') };

    await writes.submit('continuation', CONTINUATION);
    await writes.submit('proposal', PROPOSAL);
    await writes.submit('continuation', later);

    const expected: Continuation[] = [CONTINUATION, later];
    const proposals: Proposal[] = [proposalSchema.parse(PROPOSAL)];

    expect(writes.pending('continuation').map((staged) => staged.write)).toEqual(expected);
    expect(writes.pending('proposal').map((staged) => staged.write)).toEqual(proposals);
  });

  it("a capability's refusal is not staged and goes into the report", async () => {
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

    world.refusing.add('continuation');

    await expect(writes.submit('continuation', CONTINUATION)).rejects.toThrow(InvalidRequestError);
    writes.refuse('schedule_continuation', 'continuation: refused on recheck');

    const report = await writes.commit();
    const expected: EffectsReport = {
      applied: [],
      refused: [{ tool: 'schedule_continuation', reason: 'continuation: refused on recheck' }],
    };

    expect(writes.pending('continuation')).toEqual([]);
    expect(report).toEqual(expected);
  });

  it('a poisoned session applies nothing', async () => {
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

    await writes.submit('continuation', CONTINUATION);
    writes.poison('get_delivery_state: connection terminated');

    const report = await writes.commit();

    expect(report.applied).toEqual([]);
    expect(report.failure).toContain('connection terminated');
    expect(world.log).toEqual(['check continuation']);
  });

  /** The conclusion must reach the ledger in time, while the run's ticket is still valid. */
  describe("the run's deadline", () => {
    it('cuts short a write waiting for an external system and stops applying there', async () => {
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const world = new World();
      const deadline = new AbortController();
      const writes = new StagedWrites(NOTICED, world.owners, deadline.signal);

      world.waiting = () => deadline.abort(new Error(DEADLINE_REACHED));
      await writes.submit('comment', OPENING);
      await writes.submit('memory_entry', DECISION);

      const report = await writes.commit();

      expect(report.applied).toEqual([]);
      expect(report.failure).toBe(DEADLINE_REACHED);
      expect(world.log).not.toContain('apply comment');
      logged.mockRestore();
    });

    it('a deadline that has been reached stops applying before the first write', async () => {
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const world = new World();
      const deadline = new AbortController();
      const writes = new StagedWrites(NOTICED, world.owners, deadline.signal);

      await writes.submit('continuation', CONTINUATION);
      deadline.abort(new Error(DEADLINE_REACHED));

      const report = await writes.commit();

      expect(report.applied).toEqual([]);
      expect(report.failure).toBe(DEADLINE_REACHED);
      expect(world.log).toEqual(['check continuation', 'check continuation']);
      logged.mockRestore();
    });
  });

  /** A write that arrived after the decision on the conclusion would fall outside it. */
  it('no write is accepted after applying or discarding', async () => {
    const world = new World();
    const committed = new StagedWrites(NOTICED, world.owners, RUNNING);
    const discarded = new StagedWrites(NOTICED, world.owners, RUNNING);

    await committed.commit();
    discarded.discard();

    expect(committed.closed).toBe(true);
    await expect(committed.submit('continuation', CONTINUATION)).rejects.toThrow('closed');
    await expect(discarded.submit('continuation', CONTINUATION)).rejects.toThrow('closed');
  });

  it('discarding applies nothing', async () => {
    const world = new World();
    const writes = new StagedWrites(NOTICED, world.owners, RUNNING);

    await writes.submit('proposal', PROPOSAL);

    const report = writes.discard();
    const expected: EffectsReport = { applied: [], refused: [] };

    expect(report).toEqual(expected);
    expect(world.log).toEqual(['check proposal']);
  });
});
