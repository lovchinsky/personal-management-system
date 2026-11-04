import { Test } from '@nestjs/testing';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { PreconditionEvaluator } from '../../src/approvals/preconditions/precondition.evaluator';
import { ProposalRequest } from '../../src/approvals/proposal.schema';
import { PendingAction } from '../../src/generated/prisma/client';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { InvalidRequestError } from '../../src/platform/request/invalid-request';
import { CHAT } from '../../src/runs/actor';
import { NOTICE_PROVIDER } from '../fixtures/proposal-notice';
import { proposeAs } from '../fixtures/propose-as';

const PAGE_ID = 'page-1';
const STATUS_ID = 'p_task_status';

/** A proposal that is executable in form: only its source can refuse it. */
const PROPOSAL: ProposalRequest = {
  effects: [
    {
      kind: 'property_write',
      pageId: PAGE_ID,
      propertyId: STATUS_ID,
      value: { kind: 'option', option: 'Done' },
    },
  ],
  preconditions: [{ kind: 'property_empty', pageId: PAGE_ID, propertyId: STATUS_ID }],
};

/**
 * `INV-015` A proposal made in the chat lives as an Inbox item. `pending_actions` is not used for
 * it.
 *
 * What is proven here is the second clause: the approval capability does not record a proposal
 * from the chat. The first clause, that such a proposal becomes an Inbox item with a comment, is
 * guaranteed by the chat step `park_inbox_item`, which `chat-session.spec.ts` proves. `INV-313`
 * proves that the chat has no proposal tool.
 */
describe('INV-015', () => {
  it('a proposal from the chat does not become a `pending_actions` row', async () => {
    const written: unknown[] = [];
    const actions: Pick<PendingActionRepository, 'propose'> = {
      propose: (proposal) => {
        written.push(proposal);

        return Promise.reject(new Error('a chat proposal reached pending_actions'));
      },
    };

    // The refusal comes before anything reads Notion or encodes a value.
    const preconditions: Pick<PreconditionEvaluator, 'evaluate'> = {
      evaluate: () => Promise.reject(new Error('a chat proposal reached the precondition check')),
    };
    const semantics: Pick<SemanticAdapter, 'encodeOn'> = {
      encodeOn: () => {
        throw new Error('a chat proposal reached the encoding');
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        { provide: PendingActionRepository, useValue: actions },
        { provide: PreconditionEvaluator, useValue: preconditions },
        { provide: SemanticAdapter, useValue: semantics },
        NOTICE_PROVIDER,
      ],
    }).compile();
    const approvals = moduleRef.get(ApprovalsService);

    const outcome: Promise<PendingAction> = proposeAs(approvals, CHAT, PROPOSAL);

    await expect(outcome).rejects.toThrow(InvalidRequestError);
    expect(written).toHaveLength(0);
  });
});
