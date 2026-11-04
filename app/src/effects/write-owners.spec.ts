import { NOTICED } from '../../test/fixtures/actors';
import { QUEUED } from '../../test/fixtures/queued-delivery';
import { Delivery } from '../delivery/delivery.schema';
import { AppliedEffect } from '../runs/run-effects';
import { RefKind, Refs } from './refs';
import { writeOwners } from './write-owners';

type Capabilities = Parameters<typeof writeOwners>[0];

/**
 * The proposal and thread as the run refers to them before applying, and the real ones they got.
 */
const PROVISIONAL_PROPOSAL = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REAL_PROPOSAL = '9b2d5c1e-3f4a-4b6c-8d7e-1a2b3c4d5e6f';
const PROVISIONAL_THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const REAL_THREAD = '3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e';

const REQUEST: Delivery = {
  idempotencyKey: 'nudge-1',
  channel: 'telegram',
  discussionId: PROVISIONAL_THREAD,
  message: {
    noticed: 'Задача чекає на відповідь постачальника',
    whyItMatters: 'Вона блокує єдиний критичний шлях проєкту',
    ask: 'Підготувати ескалацію?',
    link: 'https://www.notion.so/page-1',
    proposals: [{ pendingActionId: PROVISIONAL_PROPOSAL, line: 'Ескалювати постачальнику' }],
  },
};

/**
 * The run's references: the temporary ids of the proposal and the thread have real ones, the rest
 * resolve to themselves.
 */
const REFS: Refs = {
  minted: () => true,
  resolve: (kind: RefKind, id: string): string => {
    const real = new Map<string, string>([
      [`proposal/${PROVISIONAL_PROPOSAL}`, REAL_PROPOSAL],
      [`discussion/${PROVISIONAL_THREAD}`, REAL_THREAD],
    ]);

    return real.get(`${kind}/${id}`) ?? id;
  },
};

/** Capabilities the table entrusts with nothing: a call to one is a test failure. */
function unexpected(name: string): Error {
  return new Error(`${name} was not expected to be called`);
}

function unused(name: string): () => Promise<never> {
  return () => Promise.reject(unexpected(name));
}

function capabilities(delivery: Capabilities['delivery']): Capabilities {
  return {
    capture: {
      check: unused('capture.check'),
      convert: unused('capture.convert'),
      checkPark: unused('capture.checkPark'),
      park: unused('capture.park'),
      checkClose: unused('capture.checkClose'),
      close: unused('capture.close'),
    },
    attention: {
      check: () => {
        throw unexpected('attention.check');
      },
      comment: unused('attention.comment'),
    },
    continuations: {
      check: unused('continuations.check'),
      schedule: unused('continuations.schedule'),
      assertNotSnoozed: unused('continuations.assertNotSnoozed'),
    },
    memory: {
      check: unused('memory.check'),
      record: unused('memory.record'),
    },
    approvals: {
      check: unused('approvals.check'),
      record: unused('approvals.record'),
      awaitsDecision: unused('approvals.awaitsDecision'),
      waitingBesides: unused('approvals.waitingBesides'),
      subjectsOf: unused('approvals.subjectsOf'),
    },
    delivery,
  };
}

describe('the table of write owners', () => {
  /**
   * A run refers to what it staged itself by a temporary id. What it staged gets its real id while
   * being applied, before the delivery. The table substitutes the real id, not the capability,
   * because the delivery already sees real ids.
   */
  it("a delivery is queued with real ids: the comment's thread, the run's proposal", async () => {
    const enqueued: Delivery[] = [];
    const applied: AppliedEffect[] = [];
    const owners = writeOwners(
      capabilities({
        check: unused('delivery.check'),
        enqueue: (_actor, request) => {
          enqueued.push(request);

          return Promise.resolve(QUEUED);
        },
      }),
    );

    const real = await owners.delivery.apply(NOTICED, REQUEST, REFS, (effect) =>
      applied.push(effect),
    );

    const expected: Delivery = {
      ...REQUEST,
      discussionId: REAL_THREAD,
      message: {
        ...REQUEST.message,
        proposals: [{ pendingActionId: REAL_PROPOSAL, line: 'Ескалювати постачальнику' }],
      },
    };
    const effects: AppliedEffect[] = [{ kind: 'delivery', id: QUEUED.id }];

    expect(enqueued).toEqual([expected]);
    expect(applied).toEqual(effects);
    expect(real).toBe(QUEUED.id);
  });

  it('a delivery without buttons or a thread is queued as it is', async () => {
    const enqueued: Delivery[] = [];
    const owners = writeOwners(
      capabilities({
        check: unused('delivery.check'),
        enqueue: (_actor, request) => {
          enqueued.push(request);

          return Promise.resolve(QUEUED);
        },
      }),
    );
    const plain: Delivery = {
      idempotencyKey: REQUEST.idempotencyKey,
      channel: REQUEST.channel,
      message: { ...REQUEST.message, proposals: undefined },
    };

    await owners.delivery.apply(NOTICED, plain, REFS, () => undefined);

    expect(enqueued).toEqual([plain]);
  });
});
