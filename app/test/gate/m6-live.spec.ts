import { Test } from '@nestjs/testing';
import type { RunProvenance } from '../../src/runs/provenance';
import {
  eventEnvelope,
  recheckEnvelope,
  type TriggerEnvelope,
} from '../../src/runs/trigger-envelope';
import { evidence, goodChain, idOf, THREAD, trace, worldOf } from '../fixtures/m6-evidence.fixture';
import { worldThat } from '../fixtures/m6-probe-world.fixture';
import { HarnessError } from './gate-attempts';
import type { PageSnapshot } from './gate-claims';
import type { Residue } from './gate-cleanup';
import { LivePort } from './m6-live';
import {
  CHAIN_MOVED_DEADLINE_DAYS,
  SCENARIOS,
  SINGLE_RUNS,
  tagOf,
  variantNumber,
  type AttemptId,
} from './m6-scenarios';
import { M6World } from './m6-world';
import type { ReplyTrigger } from './scenario-kit';
import type { Ids } from './scenario-world';

const WORLD = worldOf('U1_commitment');
const IDS: Ids = Object.fromEntries(WORLD.map((page) => [page.key, idOf(page.key)]));
const ATTEMPT: AttemptId = { run: '4821', scenario: 'U1_commitment', trial: 2, attempt: 0 };

const EVENT: TriggerEnvelope = eventEnvelope('event_evaluation', {
  type: 'page.properties_updated',
  event_types: ['page.properties_updated'],
  event_id: 'event-1',
  timestamp: '2026-10-08T09:00:00.000Z',
  entity_id: idOf('prices'),
  page_id: idOf('prices'),
  updated_property_ids: [],
});
const CHECK: TriggerEnvelope = recheckEnvelope({
  event_id: 'check-1',
  page_id: idOf('waiting'),
  reason_code: 'await_external_event',
});
const PROVENANCE: RunProvenance = { origin: 'operator' };

/**
 * Builds a world that records what it sees from the port: calls in order, with the arguments that
 * matter for the measurement.
 */
async function recordingWorld(
  windowEnvelope: TriggerEnvelope = EVENT,
  checkEnvelope: TriggerEnvelope = CHECK,
): Promise<M6World & { readonly events: string[] }> {
  const app = await Test.createTestingModule({}).compile();
  const events: string[] = [];

  class Recording extends M6World {
    readonly events = events;

    override snapshots(_ids: Ids, withComments?: boolean): Promise<Record<string, PageSnapshot>> {
      events.push(`snapshots(comments=${String(withComments)})`);

      return Promise.resolve(evidence(WORLD).after);
    }

    override trigger(pageId: string, changed: readonly string[] = []): TriggerEnvelope {
      events.push(`trigger(${pageId}; ${changed.join(',')})`);

      return EVENT;
    }

    override run(envelope: TriggerEnvelope, provenance: RunProvenance) {
      events.push(`run(${envelope.mode}; ${provenance.origin})`);

      return Promise.resolve(trace());
    }

    override evidenceFor(
      step: string,
      _run: ReturnType<typeof trace>,
      _ids: Ids,
      _before: Record<string, PageSnapshot>,
      discussionId: string | null,
    ) {
      events.push(`evidence(${step}; ${String(discussionId)})`);

      return Promise.resolve(evidence(WORLD, { step, discussionId }));
    }

    override openThread(pageId: string, _residue: Residue, _actor?: unknown, text?: string) {
      events.push(`thread(${pageId}; ${String(text)})`);

      return Promise.resolve(THREAD);
    }

    override personReplies(discussionId: string, words: string) {
      events.push(`reply(${discussionId}; ${words})`);

      return Promise.resolve('telegram:77');
    }

    override claimWindowFor(eventId: string) {
      events.push(`window(${eventId})`);

      return Promise.resolve({
        envelope: windowEnvelope,
        provenance: PROVENANCE,
        pageId: idOf('prices'),
        conclude: () => {
          events.push('window concluded');

          return Promise.resolve();
        },
      });
    }

    override moveDeadline(pageId: string, inDays: number) {
      events.push(`deadline(${pageId}; ${inDays})`);

      return Promise.resolve();
    }

    override claimCheck(checkId: string) {
      events.push(`check(${checkId})`);

      return Promise.resolve({
        envelope: checkEnvelope,
        provenance: { origin: 'scheduled_check', reasonCode: 'await_external_event' } as const,
        conclude: () => {
          events.push('check concluded');

          return Promise.resolve();
        },
      });
    }

    override awaitSearchable(pageId: string, query: string) {
      events.push(`searchable(${pageId}; ${query})`);

      return Promise.resolve();
    }

    override plantMemory(pages: readonly unknown[]) {
      events.push(`plant(${pages.length})`);

      return Promise.resolve();
    }

    override clean() {
      events.push('clean');

      return Promise.resolve([]);
    }
  }

  return new Recording(app, 'm6');
}

const reply = (): ReplyTrigger => {
  const trigger = SINGLE_RUNS['U1_commitment']?.trigger;

  if (trigger?.kind !== 'reply') throw new Error('U1 is a reply scenario');

  return trigger;
};

describe('LivePort: an event on a page', () => {
  /**
   * The “before” snapshot is taken before the run and without comments: the evidence about
   * comments comes from the effects of the run, and the snapshot only says which pages existed and
   * in what state.
   */
  it('performs snapshot, event with page slots, operator run and evidence, in that order', async () => {
    const world = await recordingWorld();
    const port = new LivePort(world);
    const trigger = { kind: 'edit', page: 'prices', slots: ['task.status', 'task.date'] } as const;
    const given = await port.edit(IDS, trigger, 'run', world.begin());

    expect(world.events).toEqual([
      'snapshots(comments=false)',
      `trigger(${idOf('prices')}; task.status,task.date)`,
      'run(event_evaluation; operator)',
      'evidence(run; null)',
    ]);
    expect(given.step).toBe('run');
  });

  it('names the step as the scenario passed it, so the verdict shows which step failed', async () => {
    const world = await recordingWorld();

    await new LivePort(world).edit(
      IDS,
      { kind: 'edit', page: 'prices', slots: [] },
      'R1',
      world.begin(),
    );

    expect(world.events).toContain('evidence(R1; null)');
  });
});

describe("LivePort: the person's reply in the channel", () => {
  it('performs thread, words, snapshot, window, run, window conclusion, evidence, in that order', async () => {
    const world = await recordingWorld();
    const port = new LivePort(world);

    await port.reply(IDS, reply(), ATTEMPT, world.begin());

    expect(world.events).toEqual([
      expect.stringMatching(new RegExp(`^thread\\(${idOf('prices')}; .+\\)$`)),
      expect.stringMatching(new RegExp(`^reply\\(${THREAD}; .+\\)$`)),
      'snapshots(comments=false)',
      'window(telegram:77)',
      'run(event_evaluation; operator)',
      'window concluded',
      `evidence(reply; ${THREAD})`,
    ]);
  });

  /**
   * The comment through which the channel delivers the person's words to Notion is on the page
   * before the run. A snapshot taken before the reply would hand it to the run as “a new comment
   * from the system”.
   */
  it("takes the snapshot after the person's reply, not before it", async () => {
    const world = await recordingWorld();

    await new LivePort(world).reply(IDS, reply(), ATTEMPT, world.begin());

    const order = world.events.map((event) => event.split('(')[0]);

    expect(order.indexOf('snapshots')).toBeGreaterThan(order.indexOf('reply'));
    expect(order.indexOf('snapshots')).toBeLessThan(order.indexOf('run'));
  });

  it("takes the person's words from this attempt's pool variant and opens the thread with the scenario's words", async () => {
    const world = await recordingWorld();
    const trigger = reply();

    await new LivePort(world).reply(IDS, trigger, ATTEMPT, world.begin());

    expect(world.events[0]).toBe(`thread(${idOf('prices')}; ${trigger.opening})`);
    expect(world.events[1]).toBe(
      `reply(${THREAD}; ${trigger.words(tagOf(ATTEMPT), variantNumber(ATTEMPT))})`,
    );
  });

  it('treats a window that would not run in evaluation mode as a harness fault and starts no run', async () => {
    const world = await recordingWorld(
      recheckEnvelope({
        event_id: 'x',
        page_id: idOf('prices'),
        reason_code: 'await_external_event',
      }),
    );

    await expect(new LivePort(world).reply(IDS, reply(), ATTEMPT, world.begin())).rejects.toThrow(
      HarnessError,
    );
    expect(world.events.some((event) => event.startsWith('run('))).toBe(false);
  });
});

describe('LivePort: recheck', () => {
  const detection = goodChain().detection;
  const chainIds: Ids = Object.fromEntries(
    worldOf('W1_dependency_chain').map((page) => [page.key, idOf(page.key)]),
  );

  it('moves the deadline, wakes the continuation by id, runs and concludes the row', async () => {
    const world = await recordingWorld();
    const given = await new LivePort(world).recheck(
      chainIds,
      idOf('waiting'),
      detection,
      world.begin(),
    );

    expect(world.events).toEqual([
      `deadline(${idOf('waiting')}; ${CHAIN_MOVED_DEADLINE_DAYS})`,
      expect.stringMatching(/^check\(.+\)$/),
      'snapshots(comments=false)',
      'run(scheduled_recheck; scheduled_check)',
      'check concluded',
      `evidence(R2; ${THREAD})`,
    ]);
    expect(given?.step).toBe('R2');
  });

  it('has nothing to recheck without a continuation to wake in the first run: `null` and no call', async () => {
    const world = await recordingWorld();
    const silent = evidence(worldOf('W1_dependency_chain'), { discussionId: THREAD });

    expect(
      await new LivePort(world).recheck(chainIds, idOf('waiting'), silent, world.begin()),
    ).toBeNull();
    expect(world.events).toEqual([]);
  });

  it('treats a check that would not run in recheck mode as a harness fault', async () => {
    const world = await recordingWorld(EVENT, EVENT);

    await expect(
      new LivePort(world).recheck(chainIds, idOf('waiting'), detection, world.begin()),
    ).rejects.toThrow(HarnessError);
    expect(world.events.some((event) => event.startsWith('run('))).toBe(false);
  });
});

describe('LivePort: the remaining steps', () => {
  it('passes memory, the search for the equivalent and cleanup to the world with the same arguments', async () => {
    const world = await recordingWorld();
    const port = new LivePort(world);

    await port.plant([], IDS, world.begin());
    await port.awaitFindable(IDS, 'prices', 'пропозиція клієнту');
    await port.clean(world.begin());

    expect(world.events).toEqual([
      'plant(0)',
      `searchable(${idOf('prices')}; пропозиція клієнту)`,
      'clean',
    ]);
  });

  it('builds the world with a check: what reads differently than intended is a `HarnessError`', async () => {
    const info = SCENARIOS.find((candidate) => candidate.id === 'N1_free_path');
    const spec = SINGLE_RUNS['N1_free_path'];

    if (info === undefined || spec === undefined) throw new Error('N1 is a single run');

    const world = await worldThat({ reads: { target: 'Done' } });
    const port = new LivePort(world);

    await expect(port.build(spec.world('4821-aa'), info, world.begin())).rejects.toThrow(
      HarnessError,
    );
  });
});
