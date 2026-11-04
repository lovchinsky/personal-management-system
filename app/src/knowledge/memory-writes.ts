/**
 * Mirrors the contract on who writes to GBrain and how (`contracts/canonical.yaml`, keys
 * `memory_writes` and `memory_thresholds`). `docs/3-policy.md` § “Closure processing and memory
 * policy” owns the semantics of the kinds; `INV-100` enforces the agreement with the contract.
 *
 * Only capability names appear here, not tool names: `runs/toolsets.ts` knows which tools stand
 * behind them, so the knowledge layer does not depend on a run.
 */

/** A surface's authority over a kind of write. */
type WriteAuthority = 'autonomous' | 'person_words' | 'with_entry' | 'on_request' | 'none';

type MemoryWriteKind =
  | 'timeline_event'
  | 'fact'
  | 'decision'
  | 'standard'
  | 'compiled_truth'
  | 'anchor'
  | 'graph_link'
  | 'lesson'
  | 'cognitive_observation';

type ThresholdKey = 'lesson' | 'cognitive_observation';

interface MemoryWrite {
  readonly kind: MemoryWriteKind;
  /**
   * The capability that performs the write: an App intent (`mcp_toolsets.app.capabilities`) or a
   * native GBrain write (`mcp_toolsets.gbrain.capabilities`).
   */
  readonly capability: string;
  /** An App run. */
  readonly run: WriteAuthority;
  /** A conversation in which the person speaks for themselves. */
  readonly chat: WriteAuthority;
  /** The generalization threshold the kind must pass. */
  readonly threshold?: ThresholdKey;
}

export const MEMORY_WRITES: readonly MemoryWrite[] = [
  { kind: 'timeline_event', capability: 'memory_record', run: 'autonomous', chat: 'autonomous' },
  { kind: 'fact', capability: 'memory_record', run: 'person_words', chat: 'person_words' },
  { kind: 'decision', capability: 'memory_record', run: 'person_words', chat: 'person_words' },
  { kind: 'standard', capability: 'memory_record', run: 'person_words', chat: 'person_words' },
  { kind: 'anchor', capability: 'memory_record', run: 'with_entry', chat: 'with_entry' },
  { kind: 'compiled_truth', capability: 'page_write', run: 'none', chat: 'on_request' },
  { kind: 'graph_link', capability: 'graph_write', run: 'none', chat: 'on_request' },
  {
    kind: 'lesson',
    capability: 'page_write',
    run: 'none',
    chat: 'on_request',
    threshold: 'lesson',
  },
  {
    kind: 'cognitive_observation',
    capability: 'page_write',
    run: 'none',
    chat: 'on_request',
    threshold: 'cognitive_observation',
  },
];

/**
 * The link types GBrain accepts: `contracts/canonical.yaml`, key `memory_writes.link_verbs`.
 * The server rejects a link of any other type.
 */
export const LINK_VERBS: readonly string[] = [
  'relates_to',
  'derived_from',
  'supersedes',
  'mentions',
  'sourced_from',
];

/** The start of the `summary` of a timeline entry that is the person's decision, not an event. */
export const DECISION_MARKER = 'Decision:';

/**
 * How many GBrain calls a run makes for one event, the write included. The number comes from
 * `contracts/canonical.yaml`, key `retrieval_budgets.max_gbrain_tool_calls`. The App does not
 * enforce the budget. The Skill procedure does, and the gate measures it.
 */
export const GBRAIN_CALL_BUDGET = 4;

/**
 * The start of a fact about an Area of Focus's acceptable state, which tells that fact apart from
 * the other facts of the anchor.
 */
export const STANDARD_MARKER = 'Standard:';

interface Threshold {
  readonly minIndependentEpisodes: number;
  /** Requirements, each of which the entry itself names. */
  readonly requires: readonly string[];
}

export const MEMORY_THRESHOLDS: Readonly<Record<ThresholdKey, Threshold>> = {
  lesson: {
    minIndependentEpisodes: 2,
    requires: ['applicability_limits', 'person_confirmation'],
  },
  cognitive_observation: {
    minIndependentEpisodes: 3,
    requires: [
      'alternative_explanations',
      'confidence',
      'conditions',
      'practical_value',
      'person_confirmation',
    ],
  },
};
