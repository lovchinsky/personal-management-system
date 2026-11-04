/**
 * The attention labels a detection uses to name its type, in the contract's order
 * (`contracts/canonical.yaml`, key `detector_labels`).
 *
 * The list is kept here instead of being read from the contract, because a running App reads no
 * contracts. `app/test/contract/detector-activation-agreement.spec.ts` enforces agreement with the
 * contract and with the label modes (`detector_activation`).
 */
export const DETECTOR_LABELS = [
  'unclarified_input',
  'untracked_commitment',
  'dependency',
  'deadline_risk',
  'project_integrity',
  'behavior_system_friction',
  'area_of_focus_risk',
  'objective_evidence_change',
  'resource_conflict',
  'contradiction',
  'forgotten_context',
  'opportunity',
] as const;

type DetectorLabel = (typeof DETECTOR_LABELS)[number];

/**
 * A label's mode is the broadest one in which it can be raised (`contracts/canonical.yaml`, key
 * `detector_activation`): `proactive` means evaluating an event or a check raises it by itself;
 * `inbox_review` means it belongs to Inbox items and reviews, and event evaluation does not
 * raise it; `review_packet` means it appears in the review packet, and event evaluation raises it
 * only with a specific, urgent `why_now`; `shadow` means an autonomous run does not raise it.
 */
type ActivationMode = 'proactive' | 'inbox_review' | 'review_packet' | 'shadow';

/**
 * The mode of each label (ADR 0033); kept here, not read from the contract, for the same reason as
 * the list of labels.
 */
export const DETECTOR_ACTIVATION: Readonly<Record<DetectorLabel, ActivationMode>> = {
  unclarified_input: 'inbox_review',
  untracked_commitment: 'proactive',
  dependency: 'proactive',
  deadline_risk: 'proactive',
  project_integrity: 'proactive',
  behavior_system_friction: 'review_packet',
  area_of_focus_risk: 'review_packet',
  objective_evidence_change: 'review_packet',
  resource_conflict: 'review_packet',
  contradiction: 'proactive',
  forgotten_context: 'proactive',
  opportunity: 'shadow',
};
