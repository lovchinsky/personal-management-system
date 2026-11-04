import { Test } from '@nestjs/testing';
import { NOTICED } from '../../test/fixtures/actors';
import { TASK_STATUS_ID, TASK_STATUS_SPELLED } from '../../test/fixtures/notion-mapping.fixture';
import {
  dateProperty,
  optionProperty,
  pageFor,
  taskWithStatus,
} from '../../test/fixtures/notion-page.fixture';
import { RecordingNotice } from '../../test/fixtures/proposal-notice';
import { proposeAs } from '../../test/fixtures/propose-as';
import { bindingProvider } from '../../test/fixtures/test-module';
import { PendingAction } from '../generated/prisma/client';
import { PendingActionStatus } from '../generated/prisma/enums';
import { Page } from '../notion/client/page';
import { PageReader } from '../notion/client/page.reader';
import { CanonicalWriteRequest } from '../notion/semantics/canonical-write';
import { SemanticAdapter } from '../notion/semantics/semantic.adapter';
import { UnwritableOnPageError } from '../notion/semantics/unwritable-on-page.error';
import { UnwritableValueError } from '../notion/semantics/unwritable-value.error';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { Actor, CHANNEL_BUTTON, CHAT } from '../runs/actor';
import { InvalidProposalError } from './approvals.error';
import { ApprovalsService, MAX_PROPOSAL_CHARS } from './approvals.service';
import { PendingActionRepository } from './contracts/pending-action.repository';
import { PreconditionEvaluator } from './preconditions/precondition.evaluator';
import { PROPOSAL_NOTICE } from './proposal-notice';
import { Proposal, ProposalRequest, proposalSchema, StagedProposal } from './proposal.schema';
import { ProposalDefect } from './proposal.validity';
import { ProposalAbsentWire } from './proposal.wire';

const PAGE_ID = 'page-1';
/** Canonical: the way the model supplies it, from the trigger envelope or `get_schema_mapping`. */
const STATUS_ID = TASK_STATUS_ID;
const DATE_ID = 'p_task_date';
const NAME_ID = 'title';
const NEXT_ACTION = 'opt_next_action';

const DONE: CanonicalWriteRequest = { kind: 'option', option: 'Done' };

const PROPOSAL: ProposalRequest = {
  effects: [{ kind: 'property_write', pageId: PAGE_ID, propertyId: STATUS_ID, value: DONE }],
  preconditions: [
    { kind: 'property_equals', pageId: PAGE_ID, propertyId: STATUS_ID, optionId: NEXT_ACTION },
  ],
};

const PROPOSED: PendingAction = {
  id: 'action-1',
  discussionId: null,
  proposedByRunId: 'run-1',
  notionPageId: PAGE_ID,
  fingerprint: 'fingerprint-1',
  effects: [],
  preconditions: [],
  status: 'proposed',
  createdAt: new Date(0),
  resolvedAt: null,
  lastError: null,
  nextAttemptAt: null,
  publishedStatus: null,
  approvedAt: null,
  accessFailures: 0,
  failure: null,
  recheckRequestedAt: null,
};

/** Proposals in every status except `proposed`, one per status. */
const DECIDED: readonly PendingAction[] = Object.values(PendingActionStatus)
  .filter((status) => status !== 'proposed')
  .map((status) => ({ ...PROPOSED, id: `action-${status}`, status }));

/** The person replied in a thread that Personal Management System manages. */
const REPLY: Actor = {
  kind: 'run',
  runId: 'run-2',
  mode: 'event_evaluation',
  provenance: { origin: 'managed_discussion_reply' },
  startedAt: new Date('2026-09-28T09:00:00.000Z'),
};

/** A review on the person's schedule: exempt from the budget, but carries none of their words. */
const REVIEW: Actor = {
  kind: 'run',
  runId: 'run-3',
  mode: 'daily_control',
  provenance: { origin: 'review_schedule' },
  startedAt: new Date('2026-09-28T09:00:00.000Z'),
};

interface Approvals {
  readonly service: ApprovalsService;
  /** What reached the store: recorded proposals and decisions. */
  readonly written: string[];
  /** What was written to the store as a proposal, in the form it received. */
  readonly proposed: Proposal[];
  /** What the service told the port for notices about proposal fates. */
  readonly notice: RecordingNotice;
  /** How many times the service read the page from Notion. */
  readonly reads: () => number;
}

type Actions = Pick<
  PendingActionRepository,
  'propose' | 'approve' | 'reject' | 'find' | 'hasOpenOn'
>;

/** Checks whether the proposal still awaits a decision: decided ones accept no decision. */
const isProposed = (id: string): boolean => !DECIDED.some((action) => action.id === id);

/** A thread on which an open proposal waits. */
const PROPOSED_ON = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

/**
 * Builds a service over a store that only remembers what reached it, and over a Notion that
 * returns `page` for any id. The precondition evaluator and the adapter are real: the proposal is
 * checked the same way execution will check it. Run `run-1` made the proposal `action-1`.
 * Who made the rest is unknown.
 */
async function approvalsOver(
  page: Page = taskWithStatus(NEXT_ACTION, 'Next Action'),
): Promise<Approvals> {
  const written: string[] = [];
  const proposed: Proposal[] = [];
  const notice = new RecordingNotice();
  let reads = 0;
  const actions: Actions = {
    propose: (proposal, proposedByRunId) => {
      proposed.push(proposal);
      written.push(
        `propose ${proposal.effects.map((effect) => effect.propertyId).join(',')} by ${proposedByRunId}`,
      );

      return Promise.resolve(PROPOSED);
    },
    find: (id) =>
      Promise.resolve([PROPOSED, ...DECIDED].find((action) => action.id === id) ?? null),
    hasOpenOn: (discussionId) => Promise.resolve(discussionId === PROPOSED_ON),
    // The transition is only from `proposed`: a decided proposal accepts no decision.
    approve: (id) => {
      written.push(`approve ${id}`);

      return Promise.resolve(isProposed(id));
    },
    reject: (id) => {
      written.push(`reject ${id}`);

      return Promise.resolve(isProposed(id));
    },
  };
  const pages: Pick<PageReader, 'page'> = {
    page: () => {
      reads += 1;

      return Promise.resolve(page);
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ApprovalsService,
      PreconditionEvaluator,
      SemanticAdapter,
      { provide: PendingActionRepository, useValue: actions },
      { provide: PageReader, useValue: pages },
      { provide: PROPOSAL_NOTICE, useValue: notice },
      bindingProvider(),
    ],
  }).compile();

  return {
    service: moduleRef.get(ApprovalsService),
    written,
    proposed,
    notice,
    reads: () => reads,
  };
}

describe('approval as a capability', () => {
  it('an executable proposal of an autonomous run becomes a row', async () => {
    const { service, written } = await approvalsOver();

    await expect(proposeAs(service, NOTICED, PROPOSAL)).resolves.toEqual(PROPOSED);

    const expected: string[] = [`propose ${STATUS_ID} by run-1`];

    expect(written).toEqual(expected);
  });

  it('a check without a write says the same as the write and writes nothing', async () => {
    const { service, written } = await approvalsOver();

    await expect(service.check(NOTICED, PROPOSAL)).resolves.toMatchObject({
      effects: [{ value: DONE }],
    });
    await expect(service.check(NOTICED, { ...PROPOSAL, effects: [] })).rejects.toThrow(
      InvalidProposalError,
    );
    await expect(service.check(CHAT, PROPOSAL)).rejects.toThrow('Inbox item');
    expect(written).toHaveLength(0);
  });

  /**
   * A run's staged writes check the proposal when the model made it and once more before
   * applying. The write itself does not read Notion a third time.
   */
  it('records a checked proposal without a third check', async () => {
    const { service, written, reads } = await approvalsOver();
    const checked = await service.check(NOTICED, PROPOSAL);
    const readsAfterCheck = reads();

    await service.record(NOTICED, checked);

    expect(reads()).toBe(readsAfterCheck);
    expect(written).toEqual([`propose ${STATUS_ID} by run-1`]);
  });

  /**
   * With a button the person decides on a proposal that already exists. A button makes no new
   * proposal: not by a check, not by a write, not by a write of a proposal that is already checked.
   */
  it('a channel button makes no proposals', async () => {
    const { service, written } = await approvalsOver();
    const checked = await service.check(NOTICED, PROPOSAL);

    await expect(service.check(CHANNEL_BUTTON, PROPOSAL)).rejects.toThrow('channel button');
    await expect(proposeAs(service, CHANNEL_BUTTON, PROPOSAL)).rejects.toThrow('channel button');
    await expect(service.record(CHANNEL_BUTTON, checked)).rejects.toThrow('channel button');
    expect(written).toHaveLength(0);
  });

  /**
   * The decision is only recorded: the fate publication writes the trail in the thread and
   * rewrites the message (ADR 0043), so the answer to the button press does not wait for the
   * network (`INV-023`).
   */
  it('the decision is only recorded: the fate publication rewrites the message', async () => {
    const { service, notice, written } = await approvalsOver();

    await expect(service.approve(CHANNEL_BUTTON, PROPOSED.id)).resolves.toBe(true);

    expect(written).toEqual([`approve ${PROPOSED.id}`]);
    expect(notice.told).toEqual([]);
  });

  /** `INV-030`: the state includes status and content but no execution bookkeeping. */
  it('the state of a proposal is status and content, without execution bookkeeping', async () => {
    const { service } = await approvalsOver();
    const state = await service.state(PROPOSED.id, []);
    const absent: ProposalAbsentWire = { pending_action_id: 'absent', found: false };

    expect(state).toMatchObject({ pending_action_id: 'action-1', status: 'proposed' });
    expect(Object.keys(state)).not.toEqual(
      expect.arrayContaining(['fingerprint', 'last_error', 'next_attempt_at']),
    );
    await expect(service.state('absent', [])).resolves.toEqual(absent);
  });

  /**
   * A proposal written by a run is shown in the same form as a row: with canonical ids, not the
   * way the model sent it.
   */
  it('`state` shows a proposal written by a run as `staged`', async () => {
    const { service } = await approvalsOver();
    const undashed = '1F2E3D4C5B6A49788A9B0C1D2E3F4A5B';
    const proposal = await service.check(NOTICED, {
      ...PROPOSAL,
      effects: [{ kind: 'property_write', pageId: undashed, propertyId: STATUS_ID, value: DONE }],
      preconditions: [
        { kind: 'property_equals', pageId: undashed, propertyId: STATUS_ID, optionId: NEXT_ACTION },
      ],
    });
    const staged: StagedProposal = { provisionalId: 'provisional-1', proposal };

    await expect(service.state('provisional-1', [staged])).resolves.toMatchObject({
      pending_action_id: 'provisional-1',
      status: 'staged',
      effects: [
        {
          kind: 'property_write',
          page_id: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
          property_id: STATUS_ID,
        },
      ],
    });
  });

  /** The person reads a proposal whole before approving: an oversized one never reaches them. */
  it('an oversized proposal is already refused at the check', async () => {
    const { service, written } = await approvalsOver();
    const huge: ProposalRequest = {
      effects: [
        {
          kind: 'property_write',
          pageId: PAGE_ID,
          propertyId: NAME_ID,
          value: { kind: 'text', text: 'x'.repeat(MAX_PROPOSAL_CHARS) },
        },
      ],
      preconditions: [{ kind: 'property_empty', pageId: PAGE_ID, propertyId: NAME_ID }],
    };

    await expect(service.check(NOTICED, huge)).rejects.toThrow('too long for a person to review');
    await expect(proposeAs(service, NOTICED, huge)).rejects.toThrow(InvalidRequestError);
    expect(written).toHaveLength(0);
  });

  /** An open proposal is one of the signs of a thread the system manages (`INV-089`). */
  it('a thread with an open proposal is visible in any form of the id', async () => {
    const { service } = await approvalsOver();

    await expect(service.hasOpenFor(PROPOSED_ON.replaceAll('-', '').toUpperCase())).resolves.toBe(
      true,
    );
    await expect(service.hasOpenFor('3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e')).resolves.toBe(false);
  });

  /**
   * A button on a decided proposal would lead the person to where there is nothing left to
   * decide, and so would a button on an approved proposal: the decision is already made and only
   * execution remains.
   */
  it('only a `proposed` proposal awaits a decision', async () => {
    const { service } = await approvalsOver();
    const open: Record<string, boolean> = {};

    for (const action of [PROPOSED, ...DECIDED]) {
      open[action.status] = await service.awaitsDecision(action.id);
    }

    const expected: Record<string, boolean> = {
      proposed: true,
      approved: false,
      executed: false,
      rejected: false,
      expired: false,
      conflict: false,
      failed: false,
    };

    expect(open).toEqual(expected);
    await expect(service.awaitsDecision('absent')).resolves.toBe(false);
  });

  /**
   * An empty list of effects is rejected by the validity rule, not by the shape of the request:
   * the refusal must name the defect, not a schema bound.
   */
  it('a proposal without an effect is a defect named by the validity rule', async () => {
    const { service, written } = await approvalsOver();
    const effectless: ProposalRequest = { ...PROPOSAL, effects: [] };
    const expected: ProposalDefect[] = [{ kind: 'no_effect' }];

    const refusal = proposeAs(service, NOTICED, effectless);

    await expect(refusal).rejects.toThrow(InvalidProposalError);
    await expect(refusal).rejects.toMatchObject({ defects: expected });
    expect(written).toHaveLength(0);
  });

  it('a value of an unknown kind is a shape refusal, not a write', () => {
    const unknown: Record<string, unknown> = {
      ...PROPOSAL,
      effects: [
        {
          kind: 'property_write',
          pageId: PAGE_ID,
          propertyId: STATUS_ID,
          value: { kind: 'number', number: 1 },
        },
      ],
    };

    expect(proposalSchema.safeParse(unknown).success).toBe(false);
  });

  it('an extra proposal field is a refusal, not silence', () => {
    const smuggled: Record<string, unknown> = { ...PROPOSAL, approved: true };

    expect(proposalSchema.safeParse(smuggled).success).toBe(false);
    expect(proposalSchema.safeParse({ ...PROPOSAL }).success).toBe(true);
  });

  /**
   * A proposal that is false from the start does not reach the person: the preconditions are
   * checked on the live page already at the time of the proposal, and the model is told the reason.
   */
  it('a precondition that already does not hold is refused with a reason', async () => {
    const { service, written } = await approvalsOver(taskWithStatus('opt_done', 'Done'));
    const refusal = proposeAs(service, NOTICED, PROPOSAL);

    await expect(refusal).rejects.toThrow(InvalidRequestError);
    await expect(refusal).rejects.toThrow(
      'proposal: precondition property_equals broken — property holds opt_done',
    );
    expect(written).toHaveLength(0);
  });

  /**
   * The value is encoded the way the executor will encode it for the write, on a freshly read
   * page. A proposal that cannot be written is refused before it reaches the person, not `failed`
   * after their decision.
   */
  describe('a value that cannot be written', () => {
    /** The Task waits on a dependency and has no date yet: `Date` here is when to check. */
    const EMPTY_DATE = pageFor('task', {
      [TASK_STATUS_SPELLED]: optionProperty(TASK_STATUS_SPELLED, 'opt_waiting_for', 'Waiting For'),
      [DATE_ID]: dateProperty(DATE_ID, null),
    });
    const LOOSE = pageFor('task', { p_loose: { id: 'p_loose', type: 'rich_text', rich_text: [] } });

    const writing = (
      propertyId: string,
      value: CanonicalWriteRequest,
      watched: 'equals' | 'empty' = 'equals',
    ): ProposalRequest => ({
      effects: [{ kind: 'property_write', pageId: PAGE_ID, propertyId, value }],
      preconditions: [
        watched === 'equals'
          ? { kind: 'property_equals', pageId: PAGE_ID, propertyId, optionId: NEXT_ACTION }
          : { kind: 'property_empty', pageId: PAGE_ID, propertyId },
      ],
    });

    const refused: [string, Page, ProposalRequest, string][] = [
      [
        'an option that does not exist',
        taskWithStatus(NEXT_ACTION, 'Next Action'),
        writing(STATUS_ID, { kind: 'option', option: 'Doen' }),
        'Doen is not a canonical option of this field',
      ],
      [
        'a non-canonical option',
        taskWithStatus(NEXT_ACTION, 'Next Action'),
        writing(STATUS_ID, { kind: 'option', option: 'Hidden' }),
        'Hidden is not canonical and is never written',
      ],
      [
        'clearing a status, which Notion does not do',
        taskWithStatus(NEXT_ACTION, 'Next Action'),
        writing(STATUS_ID, { kind: 'clear' }),
        'a status property cannot be cleared',
      ],
      [
        'text written to a date',
        EMPTY_DATE,
        writing(DATE_ID, { kind: 'text', text: 'завтра' }, 'empty'),
        'a text value cannot be written into a date property',
      ],
      [
        'a property without a canonical field',
        LOOSE,
        writing('p_loose', { kind: 'text', text: 'x' }, 'empty'),
        'task p_loose: the property carries no canonical field of this type',
      ],
      [
        'a page outside the canonical types',
        { ...taskWithStatus(NEXT_ACTION, 'Next Action'), dataSourceId: null },
        PROPOSAL,
        'page page-1: lies in no data source of a canonical type',
      ],
    ];

    it.each(refused)('%s is refused and the reason is named', async (_, page, proposal, reason) => {
      const { service, written } = await approvalsOver(page);
      const refusal = proposeAs(service, NOTICED, proposal);

      await expect(refusal).rejects.toThrow(UnwritableValueError);
      await expect(refusal).rejects.toThrow(reason);
      expect(written).toHaveLength(0);
    });

    /**
     * `INV-005`: a planned date on `Next Action` means `Scheduled`. The `Next Action` status is
     * on the page, so the refusal is the page's, not the request's.
     */
    it('a date on `Next Action` without a status is refused by the page', async () => {
      const nextAction = pageFor('task', { [DATE_ID]: dateProperty(DATE_ID, null) });
      const { service, written } = await approvalsOver(nextAction);
      const refusal = proposeAs(
        service,
        NOTICED,
        writing(DATE_ID, { kind: 'date', start: '2026-10-01' }, 'empty'),
      );

      await expect(refusal).rejects.toThrow(UnwritableOnPageError);
      await expect(refusal).rejects.toThrow('a planned date makes the task Scheduled');
      expect(written).toHaveLength(0);
    });

    it('a date can be written to an empty date', async () => {
      const { service } = await approvalsOver(EMPTY_DATE);

      await expect(
        service.check(NOTICED, writing(DATE_ID, { kind: 'date', start: '2026-10-01' }, 'empty')),
      ).resolves.toMatchObject({ effects: [{ propertyId: DATE_ID }] });
    });
  });

  /**
   * Runs get the approval class because they propose. None of them can decide for the person:
   * neither a review on their schedule nor a run that handles their reply in a thread. A “yes”
   * given in words is not a decision: the person must see what will be executed, and they see it
   * next to a button or in the chat (`contracts/canonical.yaml`, key `pending_action`).
   */
  it('only the person decides, by a button or in the chat, not a run handling their reply', async () => {
    const { service, written } = await approvalsOver();
    const people: Actor[] = [CHANNEL_BUTTON, CHAT];
    const runs: Actor[] = [NOTICED, REVIEW, REPLY];

    for (const actor of people) {
      await expect(service.approve(actor, 'action-1')).resolves.toBe(true);
    }

    await expect(service.reject(CHANNEL_BUTTON, 'action-2')).resolves.toBe(true);

    for (const actor of runs) {
      await expect(service.approve(actor, 'action-1')).rejects.toThrow(InvalidRequestError);
      await expect(service.reject(actor, 'action-1')).rejects.toThrow(InvalidRequestError);
    }

    const expected: string[] = ['approve action-1', 'approve action-1', 'reject action-2'];

    expect(written).toEqual(expected);
  });

  /**
   * The model may take a page id from a URL, where there are no hyphens. Without a single form,
   * an effect and a precondition about the same page would not match, and the validity rule would
   * reject a valid proposal.
   */
  it('a page id with and without hyphens is the same page', async () => {
    const { service, proposed } = await approvalsOver();
    const dashed = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
    const request: ProposalRequest = {
      ...PROPOSAL,
      effects: [
        {
          kind: 'property_write',
          pageId: '1F2E3D4C5B6A49788A9B0C1D2E3F4A5B',
          propertyId: STATUS_ID,
          value: DONE,
        },
      ],
      preconditions: [
        { kind: 'property_equals', pageId: dashed, propertyId: STATUS_ID, optionId: NEXT_ACTION },
      ],
    };

    await proposeAs(service, NOTICED, request);

    expect(proposed[0].effects[0].pageId).toBe(dashed);
  });
});
