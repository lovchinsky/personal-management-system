import { BindingFile, Representation } from '../../src/notion/binding/binding.schema';
import { propertyIdFromCanonical } from '../../src/notion/client/property-id';

/**
 * A synthetic but complete binding. No id here exists in any Notion workspace. The names are
 * readable so that a mistake in a test is visible at a glance.
 *
 * The shape follows the real case: both dates have their own properties, the mechanisms are
 * reachable from an Objective only by traversal, an Area of Focus's acceptable state lives in
 * GBrain, and the rest of the prose is in the page body.
 *
 * Typed on purpose: a new field in the schema breaks compilation here instead of quietly slipping
 * past the test.
 */

type Fields = BindingFile['fields'];
type OptionSets = BindingFile['options'];
type Kind<K extends Representation['kind']> = Extract<Representation, { kind: K }>;

const native = (propertyId: string): Kind<'native'> => ({ kind: 'native', propertyId });

/**
 * The Task status, in its binding form and its canonical form.
 *
 * Percent-encoded on purpose. The status passes through both decoding and proposal preconditions,
 * so with an ID in this form both paths check the translation on the way in, not a match of
 * identical strings.
 */
export const TASK_STATUS_SPELLED = 'p_task%7Bstatus';
export const TASK_STATUS_ID = propertyIdFromCanonical('p_task{status');

const relation = (propertyId: string, dataSourceId: string): Kind<'relation'> => ({
  kind: 'relation',
  propertyId,
  dataSourceId,
  twoWay: true,
  syncedPropertyId: 'synced_' + propertyId,
});

const traversed = (via: string): Kind<'traversed'> => ({
  kind: 'traversed',
  via,
  rule: 'through_key_results',
});

const body = (): Kind<'page_body'> => ({ kind: 'page_body' });

const gbrain = (): Kind<'gbrain'> => ({ kind: 'gbrain' });

const absent = (reason: string): Kind<'absent'> => ({ kind: 'absent', reason });

const dataSources: BindingFile['data_sources'] = {
  identity: 'ds_identity',
  area_of_focus: 'ds_area_of_focus',
  objective: 'ds_objective',
  key_result: 'ds_key_result',
  project: 'ds_project',
  behavior_system: 'ds_behavior_system',
  task: 'ds_task',
  inbox_item: 'ds_inbox_item',
};

const identity: Fields['identity'] = {
  name: native('title'),
  meaning: body(),
  principles: body(),
  boundaries: body(),
  areas_of_focus: relation('r_identity_areas_of_focus', 'ds_areas_of_focus'),
  behavior_systems: relation('r_identity_behavior_systems', 'ds_behavior_systems'),
};

const areaOfFocus: Fields['area_of_focus'] = {
  name: native('title'),
  standard: gbrain(),
  mode: native('p_area_of_focus_mode'),
  signals_to_watch: body(),
  current_concerns: body(),
  identities: relation('r_area_of_focus_identities', 'ds_identities'),
  objectives: relation('r_area_of_focus_objectives', 'ds_objectives'),
  projects: relation('r_area_of_focus_projects', 'ds_projects'),
  behavior_systems: relation('r_area_of_focus_behavior_systems', 'ds_behavior_systems'),
  tasks: relation('r_area_of_focus_tasks', 'ds_tasks'),
};

const objective: Fields['objective'] = {
  desired_change: native('title'),
  why_now: absent('why_now has no carrier'),
  time_horizon: absent('time_horizon has no carrier'),
  key_results: relation('r_objective_key_results', 'ds_key_results'),
  supports_area_of_focus: relation(
    'r_objective_supports_area_of_focus',
    'ds_supports_area_of_focus',
  ),
  supporting_projects: traversed('aFBO'),
  supporting_behavior_systems: traversed('aFBO'),
  review_notes: absent('review_notes has no carrier'),
};

const keyResult: Fields['key_result'] = {
  name: native('title'),
  objective: relation('r_key_result_objective', 'ds_objective'),
  // The `via` is percent-encoded because a traversal carrier is translated the same way as a
  // field.
  supporting_projects: traversed('dN%7BH'),
  supporting_behavior_systems: traversed('aFBO'),
  tasks: relation('r_key_result_tasks', 'ds_tasks'),
};

const project: Fields['project'] = {
  name: native('title'),
  definition_of_done: body(),
  status: native('p_project_status'),
  area_of_focus: relation('r_project_area_of_focus', 'ds_area_of_focus'),
  key_results: relation('r_project_key_results', 'ds_key_results'),
  behavior_systems: relation('r_project_behavior_systems', 'ds_behavior_systems'),
  tasks: relation('r_project_tasks', 'ds_tasks'),
  support: body(),
};

const behaviorSystem: Fields['behavior_system'] = {
  behavior: native('title'),
  supports_identity: relation('r_behavior_system_supports_identity', 'ds_supports_identity'),
  supports_area_of_focus: relation(
    'r_behavior_system_supports_area_of_focus',
    'ds_supports_area_of_focus',
  ),
  supports_key_result: relation('r_behavior_system_supports_key_result', 'ds_supports_key_result'),
  supports_project: relation('r_behavior_system_supports_project', 'ds_supports_project'),
  lifecycle: native('p_behavior_system_lifecycle'),
  automaticity_or_form: body(),
  cue: body(),
  context: relation('r_behavior_system_context', 'ds_context'),
  frequency_or_cadence: body(),
  minimum_version: body(),
  target_version: body(),
  environment_design: body(),
  success_rule: body(),
  recovery_rule: body(),
  tracking: body(),
  tasks: relation('r_behavior_system_tasks', 'ds_tasks'),
};

const task: Fields['task'] = {
  name: native('title'),
  status: native(TASK_STATUS_SPELLED),
  project: relation('r_task_project', 'ds_project'),
  behavior_system: relation('r_task_behavior_system', 'ds_behavior_system'),
  key_results: relation('r_task_key_results', 'ds_key_results'),
  area_of_focus: relation('r_task_area_of_focus', 'ds_area_of_focus'),
  // Percent-encoded on purpose, and not for show. In a live workspace property IDs have this form
  // (`HZN%60`, `o%7B%40c`) because the binding keeps them URL-safe. A fixture with no id of this
  // kind would leave the translation on the way in unchecked wherever it is needed.
  dependencies: relation('r_task%7Bdependencies', 'ds_dependencies'),
  waiting_for: body(),
  date: native('p_task_date'),
  deadline: native('p_task_deadline'),
  context_or_constraint: relation('r_task_context_or_constraint', 'ds_context_or_constraint'),
  result_or_note: body(),
};

const inboxItem: Fields['inbox_item'] = {
  captured_title: native('title'),
  captured_text: absent('captured_text has no carrier'),
  captured_at: native('p_inbox_item_captured_at'),
  source: absent('source has no carrier'),
  clarified_at: absent('clarified_at has no carrier'),
};

const fields: Fields = {
  identity: identity,
  area_of_focus: areaOfFocus,
  objective: objective,
  key_result: keyResult,
  project: project,
  behavior_system: behaviorSystem,
  task: task,
  inbox_item: inboxItem,
};

const taskStatus: NonNullable<OptionSets['task.status']> = {
  canonical: {
    'Next Action': 'opt_next_action',
    Scheduled: 'opt_scheduled',
    'Waiting For': 'opt_waiting_for',
    'Someday/Maybe': 'opt_someday',
    Done: 'opt_done',
    Canceled: 'opt_canceled',
    Failed: 'opt_failed',
  },
  known_non_canonical: { Hidden: 'opt_hidden' },
};

const projectStatus: NonNullable<OptionSets['project.status']> = {
  canonical: {
    Planning: 'opt_planning',
    Active: 'opt_active',
    Paused: 'opt_paused',
    Done: 'opt_pr_done',
    Canceled: 'opt_pr_canceled',
  },
};

const areaOfFocusMode: NonNullable<OptionSets['area_of_focus.mode']> = {
  canonical: { Advance: 'opt_advance', Maintain: 'opt_maintain', Minimum: 'opt_minimum' },
};

const behaviorSystemLifecycle: NonNullable<OptionSets['behavior_system.lifecycle']> = {
  canonical: {
    Designed: 'opt_designed',
    Installing: 'opt_installing',
    Stabilizing: 'opt_stabilizing',
    Maintenance: 'opt_maintenance',
    Retired: 'opt_retired',
  },
};

const options: OptionSets = {
  'task.status': taskStatus,
  'project.status': projectStatus,
  'area_of_focus.mode': areaOfFocusMode,
  'behavior_system.lifecycle': behaviorSystemLifecycle,
};

/** Not all nine: a signal is optional, and the fixture must show that. */
const signals: NonNullable<BindingFile['signals']> = {
  // A signal in percent-encoded form, translated the same way as fields.
  'task.blocked': 'f_task%3Fblocked',
  'task.effective_areas_of_focus': 'f_task_areas',
  'project.blocked': 'f_project_blocked',
  'behavior_system.streak': 'f_behavior_system_streak',
};

export const VALID_BINDING_FILE: BindingFile = {
  workspace: 'fixture-workspace',
  data_sources: dataSources,
  fields,
  options,
  signals,
};
