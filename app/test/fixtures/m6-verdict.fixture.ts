import type { Claim, Kind, Observation, Polarity } from '../gate/gate-claims';
import type { Artifact } from '../gate/m6-claims';
import type { Attempt6, Repetition } from '../gate/m6-verdict';

/**
 * Components of the gate M6 verdict without Notion or the model: observations, claims, attempts and
 * trials.
 */
export const observation = (
  item: string,
  kind: Kind,
  ok: boolean,
  polarity: Polarity = 'positive',
): Observation =>
  kind === 'recognition'
    ? { item, kind, polarity, ok, expected: true, actual: ok }
    : { item, kind, ok, expected: true, actual: ok };

export const claim = (observations: Observation[], unobserved: string[] = []): Claim => ({
  ok: observations.every((item) => item.ok),
  observations,
  unobserved,
});

export const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  step: 'run',
  run: 'run-1',
  status: 'completed',
  reason: null,
  model: 'claude-opus-5-5',
  turns: 10,
  durationMs: 30_000,
  calls: { notion: 3, app: 2 },
  rejectedResults: 0,
  failedNotionCalls: 0,
  metered: 0,
  refusedQueries: 0,
  packetLengths: [],
  skillReads: [],
  rejections: [],
  gbrainCalls: [],
  refusals: [],
  comments: [],
  notices: [],
  proposals: [],
  followUps: [],
  detections: [],
  gbrainWrites: [],
  foreign: [],
  flags: [],
  ...overrides,
});

export const judged = (given: Claim, artifacts: readonly Artifact[] = []): Attempt6 => ({
  kind: 'judged',
  tag: '1-abc123',
  claim: given,
  artifacts,
});

export const errored = (
  error = 'the world could not be built',
  cause: 'harness' | 'infrastructure' | 'unexpected' = 'infrastructure',
): Attempt6 => ({
  kind: 'error',
  tag: '1-abc123',
  cause,
  error,
  artifacts: [],
});

export const trial = (number: number, ...attempts: Attempt6[]): Repetition => ({
  number,
  attempts,
});

/** Builds an attempt with one effect observation and one recognition observation. */
export const both = (effect: boolean, recognition: boolean): Attempt6 =>
  judged(
    claim([
      observation('no noise', 'effect', effect),
      observation('raised', 'recognition', recognition),
    ]),
  );
