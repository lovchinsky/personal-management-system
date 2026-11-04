import { z } from 'zod';
import type { Assert } from '../../platform/types/assert';

/**
 * The binding file format is one schema, from which the types are derived.
 *
 * The file is installation data, not repository data. It lives in `infra/notion/`, stays out of
 * git and is read once at App startup. The schema is strict: an extra key in any block is a
 * refusal, not silence, and `null` never replaces a value, so “not filled in yet” does not pass
 * startup (`infra/RUNBOOK.md`).
 */

/**
 * A Notion identifier: the id of a database, property or option.
 *
 * The format is deliberately not checked, because Notion issues `title`, `aGCp`, `%7DEmk` and
 * `t|U^` alike. Any regex that demanded a form would reject valid values; only an empty value or
 * one made up of nothing but whitespace is rejected.
 */
const notionId = z.string().regex(/\S/, 'must not be blank');

/**
 * The ways a canonical semantic is represented in the physical workspace.
 *
 * The discriminator and the makeup of the payloads come from `contracts/canonical.yaml`, key
 * `representation_kinds`. The schema implements the contract and is not an invention of its own.
 */
const representationSchema = z.discriminatedUnion('kind', [
  /** An ordinary Notion property. */
  z.strictObject({ kind: z.literal('native'), propertyId: notionId }),

  /**
   * A relation: its direction and target matter for a write
   * (`docs/2-system.md` § “Logical interface of the adapter”).
   */
  z.strictObject({
    kind: z.literal('relation'),
    propertyId: notionId,
    dataSourceId: notionId,
    twoWay: z.boolean(),
    syncedPropertyId: notionId.optional(),
  }),

  /** Reachable only by traversing another relation. */
  z.strictObject({
    kind: z.literal('traversed'),
    via: notionId,
    rule: z.enum(['through_key_results', 'through_task_instances']),
  }),

  /** Prose in the page body, read in full. */
  z.strictObject({ kind: z.literal('page_body') }),

  /** The emergent semantic of the object's GBrain anchor. */
  z.strictObject({ kind: z.literal('gbrain') }),

  /** The semantic exists nowhere. This is a declared decision, not a skipped slot. */
  z.strictObject({ kind: z.literal('absent'), reason: z.string().min(1) }),
]);

export type Representation = z.infer<typeof representationSchema>;

const slot = representationSchema;

/**
 * The canonical fields per `contracts/canonical.yaml`, key `field_contract`.
 *
 * The order of types and fields repeats the contract word for word, so that the check reads as a
 * comparison of two columns. Names stay snake_case: renaming to camelCase would be a layer that
 * can drift apart from the contract.
 */
const fieldsSchema = z.strictObject({
  identity: z.strictObject({
    name: slot,
    meaning: slot,
    principles: slot,
    boundaries: slot,
    areas_of_focus: slot,
    behavior_systems: slot,
  }),
  area_of_focus: z.strictObject({
    name: slot,
    standard: slot,
    mode: slot,
    signals_to_watch: slot,
    current_concerns: slot,
    identities: slot,
    objectives: slot,
    projects: slot,
    behavior_systems: slot,
    tasks: slot,
  }),
  objective: z.strictObject({
    desired_change: slot,
    why_now: slot,
    time_horizon: slot,
    key_results: slot,
    supports_area_of_focus: slot,
    supporting_projects: slot,
    supporting_behavior_systems: slot,
    review_notes: slot,
  }),
  key_result: z.strictObject({
    name: slot,
    objective: slot,
    supporting_projects: slot,
    supporting_behavior_systems: slot,
    tasks: slot,
  }),
  project: z.strictObject({
    name: slot,
    definition_of_done: slot,
    status: slot,
    area_of_focus: slot,
    key_results: slot,
    behavior_systems: slot,
    tasks: slot,
    support: slot,
  }),
  behavior_system: z.strictObject({
    behavior: slot,
    supports_identity: slot,
    supports_area_of_focus: slot,
    supports_key_result: slot,
    supports_project: slot,
    lifecycle: slot,
    automaticity_or_form: slot,
    cue: slot,
    context: slot,
    frequency_or_cadence: slot,
    minimum_version: slot,
    target_version: slot,
    environment_design: slot,
    success_rule: slot,
    recovery_rule: slot,
    tracking: slot,
    tasks: slot,
  }),
  task: z.strictObject({
    name: slot,
    status: slot,
    project: slot,
    behavior_system: slot,
    key_results: slot,
    area_of_focus: slot,
    dependencies: slot,
    waiting_for: slot,
    date: slot,
    deadline: slot,
    context_or_constraint: slot,
    result_or_note: slot,
  }),
  inbox_item: z.strictObject({
    captured_title: slot,
    captured_text: slot,
    captured_at: slot,
    source: slot,
    clarified_at: slot,
  }),
});

/** The canonical types. There is one list, the makeup of `fieldsSchema`; no second one exists. */
const canonicalTypeSchema = fieldsSchema.keyof();

export type CanonicalType = z.infer<typeof canonicalTypeSchema>;

export const CANONICAL_TYPES: readonly CanonicalType[] = canonicalTypeSchema.options;

/**
 * The option ids of the mutually exclusive value sets declared in `contracts/canonical.yaml`
 * (`levels`, `definitions`, `field_contract`).
 *
 * The key is the field (`task.status`), not the object type, because an option id belongs to a
 * specific property (`D5`). Only a field bound as `native` needs a set: in a `page_body`
 * representation the value is recognized by text, and no option id exists. `bindingOf` enforces
 * this dependency. An empty block `{}` is also an answer: no field with mutually exclusive values
 * is bound as `native`.
 */
const optionSetsSchema = z.strictObject({
  'task.status': z
    .strictObject({
      canonical: z.strictObject({
        'Next Action': notionId,
        Scheduled: notionId,
        'Waiting For': notionId,
        'Someday/Maybe': notionId,
        Done: notionId,
        Canceled: notionId,
        Failed: notionId,
      }),
      /**
       * Values that physically exist but do not belong to the canonical model (`D5`).
       *
       * The block is optional because someone else's workspace may have no such options. The
       * adapter treats an undeclared value as `schema_gap` — loudly, not silently (`INV-001`).
       */
      known_non_canonical: z.strictObject({ Hidden: notionId.optional() }).optional(),
    })
    .optional(),
  'project.status': z
    .strictObject({
      canonical: z.strictObject({
        Planning: notionId,
        Active: notionId,
        Paused: notionId,
        Done: notionId,
        Canceled: notionId,
      }),
    })
    .optional(),
  'area_of_focus.mode': z
    .strictObject({
      canonical: z.strictObject({ Advance: notionId, Maintain: notionId, Minimum: notionId }),
    })
    .optional(),
  'behavior_system.lifecycle': z
    .strictObject({
      canonical: z.strictObject({
        Designed: notionId,
        Installing: notionId,
        Stabilizing: notionId,
        Maintenance: notionId,
        Retired: notionId,
      }),
    })
    .optional(),
});

/**
 * The workspace's computed properties per `contracts/canonical.yaml`, key `signals`.
 *
 * The list of names is an array: it is visible at runtime, so the conformance test checks it
 * against the contract directly.
 */
export const SIGNAL_SLOTS = [
  'task.blocked',
  'task.effective_areas_of_focus',
  'task.effective_tags',
  'project.blocked',
  'project.effective_areas_of_focus',
  'behavior_system.streak',
  'behavior_system.completed_instances',
  'behavior_system.failed_instances',
] as const;

export type SignalSlot = (typeof SIGNAL_SLOTS)[number];

/**
 * Every signal is optional because it is a shortcut to a fact the model also arrives at on its
 * own, only by a costlier route. A missing signal is not a degradation. But a signal the contract
 * does not name cannot be accepted: otherwise a mistake in the name passes silently, and the
 * signal is simply not read.
 */
const signalsSchema = z.partialRecord(z.enum(SIGNAL_SLOTS), notionId, {
  error: (issue) =>
    issue.code === 'invalid_key' ? 'the contract declares no such signal' : undefined,
});

/**
 * The binding of the canonical model to one physical Notion workspace.
 *
 * It is `bindingOf`, not the format, that rejects identical ids across different types, because a
 * page belongs to a type by the data source it lives in, and that is a rule of the model, not of
 * how the file is written.
 */
export const bindingFileSchema = z.strictObject({
  /** Identifies which workspace the file belongs to. The App does not use it. */
  workspace: notionId,
  /** Canonical type → id of the physical data source. */
  data_sources: z.record(canonicalTypeSchema, notionId),
  /** Canonical type → canonical field → representation kind. */
  fields: fieldsSchema,
  options: optionSetsSchema,
  /** The whole block is optional because an installation may have no signals at all. */
  signals: signalsSchema.optional(),
});

export type BindingFile = z.infer<typeof bindingFileSchema>;

type FieldSlot = {
  [T in CanonicalType]: `${T}.${keyof BindingFile['fields'][T] & string}`;
}[CanonicalType];

/**
 * An option id set belongs to a field, so renaming the field or the set breaks the build, not the
 * behavior.
 */
export type OptionSetsBelongToFields = Assert<
  [keyof BindingFile['options']] extends [FieldSlot] ? true : false
>;
