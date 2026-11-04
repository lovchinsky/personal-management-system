import type { ReviewMode } from '../../src/runs/trigger-envelope';
import { idOf } from '../fixtures/m6-evidence.fixture';
import { ran } from '../fixtures/m8-evidence.fixture';
import { InfrastructureError } from './gate-attempts';
import { emptyResidue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import { SCENARIOS, type ScenarioId, type ScenarioInfo } from './m6-scenarios';
import { m8Conductors } from './m8-conduct';
import type {
  ClaimedWindow,
  Evidence8,
  M8Port,
  OpenedThread,
  ReconcileTick,
  Woken,
} from './m8-evidence';
import type { Ids, IntakeView, NotionEventInput } from './scenario-world';

function info(id: ScenarioId): ScenarioInfo {
  const found = SCENARIOS.find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`no scenario ${id}`);

  return found;
}

/** The world over which the stub review of each mode produces evidence. */
const REVIEWED: Readonly<Record<ReviewMode, ScenarioId>> = {
  daily_control: 'D1_daily_control',
  weekly_control_review: 'W1_weekly_review',
  strategic_review: 'S1_strategic_review',
  deep_review: 'DP1_deep_review',
};

/** A witness port: the log of steps in order and the answers the test sets. */
class FakePort implements M8Port {
  readonly calls: string[] = [];
  isolated = true;
  woken: readonly Woken[] = [];
  resolves = true;

  begin(): ReturnType<M8Port['begin']> {
    return emptyResidue();
  }

  awaitAllowance(mode: string): Promise<void> {
    this.calls.push(`allowance:${mode}`);

    return Promise.resolve();
  }

  assertIsolated(): Promise<void> {
    this.calls.push('isolated');

    return this.isolated
      ? Promise.resolve()
      : Promise.reject(new InfrastructureError('the gate environment holds a stray page'));
  }

  buildWorld(pages: World): Promise<Ids> {
    this.calls.push('build');

    return Promise.resolve(Object.fromEntries(pages.map((page) => [page.key, idOf(page.key)])));
  }

  plant(): Promise<void> {
    this.calls.push('plant');

    return Promise.resolve();
  }

  review(mode: ReviewMode): Promise<Evidence8> {
    this.calls.push(`review:${mode}`);

    return Promise.resolve(ran(REVIEWED[mode], {}));
  }

  plantProposal(_ids: Ids, key: string): Promise<string> {
    this.calls.push(`proposal:${key}`);

    return Promise.resolve('proposal-1');
  }

  personAnswers(_ids: Ids, key: string): Promise<void> {
    this.calls.push(`answers:${key}`);

    return Promise.resolve();
  }

  systemThread(_ids: Ids, _key: string, text: string): Promise<OpenedThread> {
    this.calls.push('thread');

    return Promise.resolve({
      discussionId: `thread-${text.length}`,
      commentId: `comment-${text.length}`,
    });
  }

  sweepTick(): Promise<readonly Woken[]> {
    this.calls.push('sweep');

    const woken = this.woken;

    this.woken = [];

    return Promise.resolve(woken);
  }

  wake(checkId: string): Promise<Evidence8> {
    this.calls.push(`wake:${checkId}`);

    return Promise.resolve(ran('SW1_safety_sweep', {}));
  }

  reconcileTick(): Promise<ReconcileTick> {
    this.calls.push('reconcile');

    return Promise.resolve({ closures: [], memory: {} });
  }

  personResolves(): Promise<boolean> {
    this.calls.push('resolves');

    return Promise.resolve(this.resolves);
  }

  deleteComment(): Promise<void> {
    this.calls.push('delete');

    return Promise.resolve();
  }

  writeNote(_ids: Ids, key: string): Promise<void> {
    this.calls.push(`note:${key}`);

    return Promise.resolve();
  }

  personMovesDeadline(_ids: Ids, key: string): Promise<void> {
    this.calls.push(`deadline:${key}`);

    return Promise.resolve();
  }

  notionEvent(_ids: Ids, event: NotionEventInput): Promise<IntakeView> {
    this.calls.push(`event:${event.type}:${event.page}`);

    return Promise.resolve({
      eventId: `${event.type}:${event.page}`,
      windowed: event.page !== 'home',
      reason: event.page === 'home' ? 'outside the Task and Project data sources' : null,
    });
  }

  claimWindow(eventId: string): Promise<ClaimedWindow> {
    this.calls.push(`window:${eventId}`);

    return Promise.resolve({
      mode: 'event_evaluation',
      eventTypes: ['page.content_updated', 'page.properties_updated'],
      type: 'page.properties_updated',
      pageId: idOf('estimate'),
      run: () => {
        this.calls.push('window-run');

        return Promise.resolve(ran('X1_body_commitment', {}));
      },
    });
  }

  clean(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

const attempt = (scenario: ScenarioId) => ({ run: '4821', scenario, trial: 1, attempt: 0 });

async function conduct(id: ScenarioId, port: FakePort, manual = true) {
  const conductor = m8Conductors(port, manual)[id];

  if (conductor === undefined) throw new Error(`no conductor for ${id}`);

  return conductor(info(id), attempt(id), emptyResidue(), (evidence) => evidence);
}

describe('gate M8 conductors', () => {
  it.each(SCENARIOS.filter((item) => item.suite === 'm8').map((item) => item.id))(
    '%s: first the checked environment, then the world and its memory',
    async (id) => {
      const port = new FakePort();

      await conduct(id, port);

      const steps = port.calls.filter((call) => !call.startsWith('allowance:'));

      expect(steps.slice(0, 3)).toEqual(['isolated', 'build', 'plant']);
    },
  );

  /**
   * An hour of waiting must not fall between building a world with “today” dates and the run over
   * it.
   */
  it('a scenario with a model waits for the allowance of its mode before the world, one without a model does not', async () => {
    const weekly = new FakePort();
    const reconciliation = new FakePort();

    await conduct('W1_weekly_review', weekly);
    await conduct('C1_resolution_reconciled', reconciliation, false);

    expect(weekly.calls[0]).toBe('allowance:weekly_control_review');
    expect(reconciliation.calls.some((call) => call.startsWith('allowance:'))).toBe(false);
  });

  it('an attempt builds no world in an environment with foreign content', async () => {
    const port = new FakePort();

    port.isolated = false;

    await expect(conduct('W1_weekly_review', port)).rejects.toThrow('stray page');
    expect(port.calls).toEqual(['allowance:weekly_control_review', 'isolated']);
  });

  it('C1 with an operator: a tick, the resolution, the deletion, two ticks', async () => {
    const port = new FakePort();

    await conduct('C1_resolution_reconciled', port);

    expect(port.calls.slice(3)).toEqual([
      'thread',
      'thread',
      'thread',
      'reconcile',
      'resolves',
      'delete',
      'reconcile',
      'reconcile',
    ]);
  });

  it('C1 without an operator: the person is not called and the resolution step is not conducted', async () => {
    const port = new FakePort();
    const claim = await conduct('C1_resolution_reconciled', port, false);

    expect(port.calls).not.toContain('resolves');
    expect(claim.unobserved).toHaveLength(1);
  });

  it('C1: when the operator is too late, the step counts as not conducted instead of violated', async () => {
    const port = new FakePort();

    port.resolves = false;

    expect((await conduct('C1_resolution_reconciled', port)).unobserved).toHaveLength(1);
  });

  it('D1: the proposal appears before the review, and the review is daily', async () => {
    const port = new FakePort();

    await conduct('D1_daily_control', port);

    expect(port.calls.slice(4)).toEqual(['proposal:kessel', 'review:daily_control']);
  });

  it('S1: the person answers on both Objectives before the review', async () => {
    const port = new FakePort();

    await conduct('S1_strategic_review', port);

    expect(port.calls.slice(4)).toEqual([
      'answers:course',
      'answers:race',
      'review:strategic_review',
    ]);
  });

  it('SW1: only the wake of the scenario Task gets a run; the second tick follows it', async () => {
    const port = new FakePort();

    port.woken = [
      { checkId: 'check-other', pageId: idOf('paused') },
      { checkId: 'check-1', pageId: idOf('woken') },
    ];

    await conduct('SW1_safety_sweep', port);

    expect(port.calls.slice(4)).toEqual(['sweep', 'wake:check-1', 'sweep']);
  });

  it('SW1: when the Task is not woken there is no run', async () => {
    const port = new FakePort();

    await conduct('SW1_safety_sweep', port);

    expect(port.calls.slice(4)).toEqual(['sweep', 'sweep']);
  });

  it('X1: the body, the body event, the deadline, the properties event, the control and the window of the last event', async () => {
    const port = new FakePort();

    await conduct('X1_body_commitment', port);

    expect(port.calls.slice(4)).toEqual([
      'note:estimate',
      'event:page.content_updated:estimate',
      'deadline:estimate',
      'event:page.properties_updated:estimate',
      'event:page.content_updated:home',
      'window:page.properties_updated:estimate',
      'window-run',
    ]);
  });
});
