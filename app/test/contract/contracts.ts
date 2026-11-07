import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

/** The repository root relative to this directory: `app/test/contract`. */
export const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * The contract is read by a test, not by the App.
 *
 * The App implements the contract with classes and does not open its file at runtime
 * (`contracts/README.md`). A conformance test is the other side: it is the one that checks the
 * implementation against the statement, so reading the source of the statement is its job.
 *
 * The tree of keys without a shape is needed only by the check of references to paths in
 * `canonical.yaml`. The rest of the tests read parts of `canonical`.
 */
export function canonicalTree(): Record<string, unknown> {
  const parsed: unknown = parse(repoFile('contracts/canonical.yaml'));

  if (!isBlock(parsed)) throw new Error('contracts/canonical.yaml is not a block of keys');

  return parsed;
}

function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns a reader of a part of `canonical.yaml` that parses it with its own schema on request. A
 * shape that has diverged fails the tests of that part, not all of them.
 */
function part<T>(key: string, schema: z.ZodType<T>): () => T {
  return () => {
    const read = schema.safeParse(canonicalTree()[key]);
    if (!read.success) {
      throw new Error(`contracts/canonical.yaml, ${key}: ${z.prettifyError(read.error)}`);
    }

    return read.data;
  };
}

const names = z.array(z.string());

const lifecycleSchema = z.object({ statuses: names, terminal: names });

const toolsetSchema = z.object({
  capabilities: z.record(z.string(), names),
  bundles: z.record(z.string(), names),
  withheld: z.record(z.string(), z.unknown()).optional(),
  untriaged: names.optional(),
  system_voice: names.optional(),
});

/** The profile is strict: a field the code does not know must fail the check, not get lost. */
const profileSchema = z.strictObject({
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  thinking: z.literal('adaptive'),
  max_turns: z.number().int().positive(),
  max_budget_usd: z.number().positive(),
});

const budgetBasketSchema = z.object({ reason_codes: names, origins: names });

const thresholdSchema = z.strictObject({
  min_independent_episodes: z.number().int().positive(),
  requires: names,
});

/** The point in a run from which a run trace field must be present in the trace. */
const requiredWhenSchema = z.enum([
  'admitted',
  'init',
  'result',
  'completed',
  'failed',
  'derived',
  'not_collected',
]);

export type RequiredWhen = z.infer<typeof requiredWhenSchema>;

/** A runtime record with a lifecycle in the contract. */
export type LifecycleKey =
  | 'webhook_receipt'
  | 'scheduled_check'
  | 'evaluation_window'
  | 'notification_delivery'
  | 'pending_action'
  | 'review_occurrence';

/** The parts of `contracts/canonical.yaml` that the tests check, in the shape they are read in. */
export const canonical = {
  levels: part('levels', z.object({ L0: z.object({ task_statuses: names }) })),
  /** The canonical objects of each Level, with their names as the methodology writes them. */
  levelObjects: part('levels', z.record(z.string(), z.object({ objects: names }))),
  projectModel: part('project_model', z.object({ core_statuses: names, rules: names })),
  taskModel: part(
    'task_model',
    z.object({ status_semantics: z.record(z.string(), z.string()), rules: names }),
  ),
  fieldContract: part('field_contract', z.record(z.string(), z.record(z.string(), z.string()))),
  signals: part('signals', z.record(z.string(), z.string())),
  gbrainAnchorShape: part(
    'gbrain_anchor_shape',
    z.object({
      fields: names,
      slug_prefixes: z.record(z.string(), z.string()),
      identity_line: z.string(),
      forbidden_frontmatter_keys: names,
      example: z.object({
        type: z.string(),
        title: z.string(),
        notion_id: z.string(),
        aliases: names,
      }),
    }),
  ),
  gbrainExactIdentity: part(
    'gbrain_exact_identity',
    z.object({ states: names, candidate_evidence: z.string() }),
  ),
  memoryWrites: part(
    'memory_writes',
    z.object({
      authority: names,
      link_verbs: names,
      kinds: z.record(
        z.string(),
        z.strictObject({
          capability: z.string(),
          run: z.string(),
          chat: z.string(),
          marker: z.string().optional(),
          threshold: z.string().optional(),
        }),
      ),
    }),
  ),
  memoryThresholds: part(
    'memory_thresholds',
    z.strictObject({
      lesson: thresholdSchema,
      cognitive_observation: thresholdSchema,
      rules: names,
    }),
  ),
  capturePolicy: part(
    'capture_policy',
    z.object({ autonomous_gbrain_fact: z.boolean(), autonomous_gbrain_lesson: z.boolean() }),
  ),
  gbrainAnchorTypes: part('gbrain_anchor_types', names),
  knownNonCanonical: part('known_non_canonical', z.array(z.object({ value: z.string() }))),
  workflowModes: part('workflow_modes', z.record(z.string(), z.object({ purpose: z.string() }))),
  reasonCodes: part('reason_codes', names),
  operatingLoop: part('operating_loop', names),
  detectorLabels: part('detector_labels', names),
  detectorActivation: part(
    'detector_activation',
    z.record(z.string(), z.enum(['proactive', 'inbox_review', 'review_packet', 'shadow'])),
  ),
  clarifyDestinations: part('clarify_destinations', names),
  retrievalBudgets: part(
    'retrieval_budgets',
    z
      .object({
        per_mode: z.record(
          z.string(),
          z.strictObject({
            max_total_tool_calls: z.number(),
            max_notion_tool_calls: z.number(),
            max_gbrain_tool_calls: z.number(),
          }),
        ),
      })
      .catchall(z.number()),
  ),
  reviewScope: part(
    'review_scope',
    z.strictObject({
      daily_horizon_days: z.number(),
      weekly_window_days: z.number(),
      inbox_stale_after_days: z.number(),
      rules: names,
    }),
  ),
  reviewSchedules: part('review_schedules', z.record(z.string(), z.string())),
  notificationPacket: part('notification_packet', z.strictObject({ max_proposals: z.number() })),
  mcpToolsets: part('mcp_toolsets', z.record(z.string(), toolsetSchema)),
  modeToolsets: part(
    'mode_toolsets',
    z.strictObject({
      required_servers: names,
      rows: z.record(z.string(), z.strictObject({ notion: names, gbrain: names, app: names })),
    }),
  ),
  harnessTools: part('harness_tools', names),
  pluginEntries: part('plugin_entries', z.strictObject({ chat: z.string(), run: z.string() })),
  runFrames: part('run_frames', names),
  chatToolset: part(
    'chat_toolset',
    z.strictObject({ app: names, excluded: z.record(z.string(), z.string().min(1)) }),
  ),
  pluginTools: part(
    'plugin_tools',
    z.strictObject({ tools: names, read_scope: z.literal('plugin_dir') }),
  ),
  evaluationResult: part(
    'evaluation_result',
    z.object({ shape: z.record(z.string(), z.unknown()) }),
  ),
  triggerEnvelope: part(
    'trigger_envelope',
    z.object({ variants: z.strictObject({ event: names, continuation: names, review: names }) }),
  ),
  runProfile: part(
    'run_profile',
    z.strictObject({
      default: profileSchema,
      per_mode: z.record(z.string(), profileSchema.partial()),
    }),
  ),
  runTraceFields: part(
    'run_trace_fields',
    z.array(z.object({ id: z.string(), required_when: requiredWhenSchema })),
  ),
  jsonDocuments: part('json_documents', z.record(z.string(), z.string().min(1))),
  lifecycle: (key: LifecycleKey) => part(key, lifecycleSchema)(),
  pendingAction: part(
    'pending_action',
    lifecycleSchema.extend({
      execution: z.strictObject({
        unavailable_max_hours: z.number().positive(),
        no_access_max_attempts: z.number().int().positive(),
      }),
    }),
  ),
  scheduledCheck: part(
    'scheduled_check',
    lifecycleSchema.extend({
      autonomous_min_lead_minutes: z.number().positive(),
      safety_recheck_max_age_days: z.number().positive(),
      notion_hold: z.strictObject({
        min_minutes: z.number().positive(),
        max_minutes: z.number().positive(),
        limit_hours: z.number().positive(),
      }),
    }),
  ),
  sweep: part(
    'sweep',
    z.object({
      tick_minutes: z.number().positive(),
      wakes_per_tick: z.number().positive(),
      wakes_per_day: z.number().positive(),
      recency_hours: z.number().positive(),
      deadline_lead_days: z.number().positive(),
      reconciliation: z.strictObject({
        tick_minutes: z.number().positive(),
        horizon_days: z.number().positive(),
        anchors_per_tick: z.number().positive(),
      }),
    }),
  ),
  relevanceGate: part('relevance_gate', z.object({ slots: names })),
  runBudget: part(
    'run_budget',
    z.object({
      daily_limit: z.number(),
      breaker_consecutive_failures: z.number(),
      concurrency: z.number(),
      work_row_max_attempts: z.number(),
      exempt: budgetBasketSchema,
      budgeted: budgetBasketSchema,
      delegating_origins: names,
    }),
  ),
  runPriority: part(
    'run_priority',
    z.object({
      classes: z.array(
        z.object({
          name: z.string(),
          origins: names.default([]),
          reason_codes: names.default([]),
        }),
      ),
      delegating_origins: names,
      unscheduled_origins: names,
    }),
  ),
  canonicalWrites: part(
    'canonical_writes',
    z.object({
      kinds: z.object({ text: names, option: names, date: names, links: names }),
      clearable: names,
    }),
  ),
};

export function repoFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

/** A service mount: the short form as a string, or the long form with a source and a target. */
const composeMount = z.union([
  z.string(),
  z.object({ source: z.string(), target: z.string(), read_only: z.boolean().optional() }),
]);

/**
 * The Compose file in the part the checks read: image, variables, build context, profiles, entry
 * point and command, service mounts and `configs` mounts, and the `configs` files.
 */
const composeSchema = z.object({
  services: z.record(
    z.string(),
    z.object({
      image: z.string().optional(),
      environment: z.record(z.string(), z.string()).optional(),
      build: z.object({ context: z.string().optional() }).optional(),
      profiles: z.array(z.string()).optional(),
      entrypoint: z.array(z.string()).optional(),
      command: z.array(z.string()).optional(),
      volumes: z.array(composeMount).optional(),
      configs: z.array(z.object({ source: z.string(), target: z.string() })).optional(),
    }),
  ),
  configs: z.record(z.string(), z.object({ file: z.string() })).optional(),
});

type Compose = z.infer<typeof composeSchema>;

/**
 * Reads a Compose file with the schema. A shape that has diverged fails the check and names the
 * file.
 */
export function composeFile(path: string): Compose {
  // Merge keys (`<<: *app-environment`) are expanded the same way Compose expands them.
  const read = composeSchema.safeParse(parse(repoFile(path), { merge: true }));
  if (!read.success) {
    throw new Error(`${path}: ${z.prettifyError(read.error)}`);
  }

  return read.data;
}

/**
 * An entry of the invariant registry. The shape is strict: an unknown field is an error, not a
 * silent extension of the format that the header of `invariants.yaml` describes.
 */
const invariantEntry = z.strictObject({
  id: z.string().regex(/^INV-\d{3}$/),
  mvp20_ordinal: z.number().int().positive().optional(),
  statement: z.string().min(1),
  origin: z.array(z.string()).min(1).optional(),
  verifiable_by: z.enum(['ci-contract', 'eval', 'integration', 'manual']),
  test: z.string().nullable(),
  related: z.array(z.string()).optional(),
  same_as: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const registry = z.strictObject({
  summary: z.strictObject({ open_contradictions: z.array(z.unknown()) }),
  invariants: z.array(invariantEntry),
});

export type Invariant = z.infer<typeof invariantEntry>;

export function invariants(): Invariant[] {
  return registry.parse(parse(repoFile('contracts/invariants.yaml'))).invariants;
}
