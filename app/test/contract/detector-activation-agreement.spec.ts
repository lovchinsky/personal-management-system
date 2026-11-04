import { DETECTOR_ACTIVATION, DETECTOR_LABELS } from '../../src/claude/result/detector-labels';
import { canonical, repoFile } from './contracts';
import { entryText } from './plugin-files';

const RUN = canonical.pluginEntries().run;

type Do = 'raise' | 'review_level' | 'not_raised';

/**
 * Classifies what `claims.md` says to do with a label: raise it, raise it only with an urgent
 * `why_now`, or not raise it.
 */
function doOf(action: string): Do | undefined {
  if (/^Raise it\b/.test(action)) return 'raise';
  if (/^Raise one only when\b/.test(action)) return 'review_level';
  if (/^Do not raise\b/.test(action)) return 'not_raised';

  return undefined;
}

/**
 * Reads the rows of the `claims.md` table: the labels of the first cell and the action of the
 * second.
 */
function claimRows(): { labels: string[]; action: string }[] {
  return entryText(RUN, 'claims.md')
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const [labels = '', action = ''] = line
        .split('|')
        .slice(1)
        .map((cell) => cell.trim());

      return { labels: [...labels.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ''), action };
    });
}

/**
 * Returns the policy sentence that names the labels of one mode, from the start of the marker to
 * the period. The mode is named in words, not in a table, so the test enforces that the labels of
 * each mode are named in the sentence of their own mode and not in another's. A missing sentence
 * is a failure, not silent agreement.
 */
function policySentence(marker: string): string {
  const text = repoFile('docs/3-policy.md');
  const start = text.indexOf(marker);

  if (start === -1) throw new Error(`the policy has no sentence starting with “${marker}”`);

  return text.slice(start).split(/\.\s/)[0] ?? '';
}

const PROSE: Readonly<Record<string, string>> = {
  proactive: 'The proactive mode runs',
  inbox_review: '`unclarified_input` works on Inbox',
  review_packet: '`behavior_system_friction`, `area_of_focus_risk`',
  shadow: 'General stagnation, opportunity',
};

/**
 * `inbox_review` is the label of the Inbox review: the Weekly Control Review surfaces a stale Inbox
 * item, and event evaluation or a recheck does not raise it (`docs/3-policy.md` § “Proactive
 * scope”).
 */
const EXPECTED: Readonly<Record<string, Do>> = {
  proactive: 'raise',
  inbox_review: 'not_raised',
  review_packet: 'review_level',
  shadow: 'not_raised',
};

/**
 * The mode of a label (`contracts/canonical.yaml`, key `detector_activation`) is one value named
 * in three places: the contract, the list in the code from which the result schema takes the
 * detection type, and the action table in `claims.md`. The test enforces that they do not diverge
 * (ADR 0033).
 */
describe('detector_activation', () => {
  const labels = canonical.detectorLabels();
  const activation = canonical.detectorActivation();

  it('the list of labels in the code is exactly `detector_labels` of the contract, in its order', () => {
    expect([...DETECTOR_LABELS]).toEqual(labels);
  });

  it('a mode is named for every label and only for labels', () => {
    expect(Object.keys(activation).sort()).toEqual([...labels].sort());
  });

  /**
   * The modes that gate M6 reads from the code are exactly those in the contract: otherwise it
   * would measure something other than what is recorded.
   */
  it('the modes in the code are exactly `detector_activation` of the contract', () => {
    expect(DETECTOR_ACTIVATION).toEqual(activation);
  });

  /**
   * The policy prose (`docs/3-policy.md` § “Proactive scope”) names the labels of each mode in one
   * sentence. The mode of a label in the key and in the prose is the same claim in two places, and
   * here they do not diverge.
   */
  it.each(Object.entries(PROSE))(
    'the policy names the labels of mode %s exactly as the key does',
    (mode, marker) => {
      const sentence = policySentence(marker);
      const named = labels.filter((label) => new RegExp(`\\b${label}\\b`).test(sentence));
      const keyed = labels.filter((label) => activation[label] === mode);

      expect(named.sort()).toEqual(keyed.sort());
    },
  );

  it('every label is in the claims.md action table exactly once', () => {
    const named = claimRows().flatMap((row) => row.labels);

    expect([...named].sort()).toEqual([...labels].sort());
  });

  it.each(labels)('the claims.md action for `%s` matches its mode', (label) => {
    const row = claimRows().find((candidate) => candidate.labels.includes(label));
    const mode = activation[label];

    expect(row && doOf(row.action)).toBe(mode && EXPECTED[mode]);
  });
});
