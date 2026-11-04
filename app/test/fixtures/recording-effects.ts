import {
  EffectsGrant,
  EffectsReport,
  RunEffects,
  RunEffectsSession,
} from '../../src/runs/run-effects';
import { NO_EFFECTS } from './run-outcome.fixture';

/** A session the dispatcher opened, and how it ended. */
interface RecordedSession {
  readonly grant: EffectsGrant;
  readonly bearer: string;
  ended?: 'committed' | 'discarded';
}

/**
 * The App's side of a run, stubbed in by the test. It records which sessions were opened and how
 * each ended, and answers `commit` with whatever the test put in `committing`.
 */
export class RecordingEffects implements RunEffects {
  readonly available = true;
  readonly sessions: RecordedSession[] = [];

  committing: EffectsReport = NO_EFFECTS;

  /** Called at every step of a session, for tests that check the order. */
  onStep?: (step: 'open' | 'commit' | 'discard') => void;

  open(grant: EffectsGrant): RunEffectsSession {
    const session: RecordedSession = { grant, bearer: `bearer-${grant.runId}` };

    this.sessions.push(session);
    this.onStep?.('open');

    return {
      url: 'http://127.0.0.1:3000/mcp',
      bearer: session.bearer,
      commit: () => {
        session.ended = 'committed';
        this.onStep?.('commit');

        return Promise.resolve(this.committing);
      },
      discard: () => {
        session.ended = 'discarded';
        this.onStep?.('discard');

        return Promise.resolve(NO_EFFECTS);
      },
    };
  }

  /** Resets the App's side to the “just created” state: no sessions, `commit` applies nothing. */
  reset(): void {
    this.sessions.length = 0;
    this.committing = NO_EFFECTS;
    this.onStep = undefined;
  }

  /** Lists how the sessions ended, in the order they were opened. */
  endings(): Array<RecordedSession['ended']> {
    return this.sessions.map((session) => session.ended);
  }
}
