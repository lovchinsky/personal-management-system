import { z } from 'zod';
import { McpServerName } from '../../generated/prisma/enums';
import { DETECTOR_LABELS } from './detector-labels';

/**
 * The functions of the methodology's operating loop that a run uses to mark its work
 * (`contracts/canonical.yaml`, key `operating_loop`).
 */
const OPERATING_PHASES = [
  'Capture',
  'Clarify',
  'Organize & Align',
  'Engage',
  'Reflect',
  'Adapt',
] as const;

/**
 * The label of a run that did not reach Notion (ADR 0045). The label is reserved: the App reads it
 * as a request to retry the same run, and trusts it only when no Notion call in the run succeeded.
 */
export const SOURCE_UNREADABLE = 'source_unreadable';

/** snake_case: lowercase letters and digits, words joined by one underscore (`no_action`). */
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * The object a conclusion rests on: the server it was read through and its identifier
 * (`INV-036`).
 *
 * `.describe()` here and below goes into the JSON Schema: the model sees the description when it
 * composes the result, so it says briefly what the schema cannot express by itself.
 */
const evidenceSchema = z.strictObject({
  server: z.enum(McpServerName),
  ref: z
    .string()
    .min(1)
    .describe('Identifier exactly as the read returned it, of an object read in this run'),
});

const detectionSchema = z.strictObject({
  type: z
    .enum(DETECTOR_LABELS)
    .describe(
      'Exactly one attention label. A claim that no label fits is not a detection: leave it out',
    ),
  claim: z.string().min(1).describe('What is asserted, in one sentence a person could check'),
  why_now: z.string().min(1).describe('The concrete reason it matters now'),
  evidence: z.array(evidenceSchema).min(1),
  counterevidence_checked: z
    .array(z.string().min(1))
    .min(1)
    .describe('What could have refuted the claim, stated concretely, and that it was looked at'),
  uncertainties: z.array(z.string()),
});

/**
 * The result of an App-triggered run (`contracts/canonical.yaml`, key `evaluation_result`).
 *
 * One schema serves both checks: the JSON Schema for `outputFormat`, which the CLI validates, is
 * emitted from it, and the App validates the result once more with the same schema, because the
 * CLI does not validate `format` (`INV-035`). The schema is strict, which means a result with a
 * field the contract does not know is not the result described. The schema enforces the content
 * the way it enforces the form: the type is a label of the contract, evidence and counterevidence
 * are non-empty, `outcome` is snake_case (ADR 0033).
 */
export const evaluationResultSchema = z.strictObject({
  outcome: z
    .string()
    .regex(SNAKE_CASE)
    .describe('snake_case label of what the run concluded, for example no_action'),
  operating_phase: z.array(z.enum(OPERATING_PHASES)).min(1),
  scope: z.strictObject({
    object_type: z.string().min(1),
    object_id: z.string().min(1),
  }),
  detections: z
    .array(detectionSchema)
    .describe(
      'One item per attention claim, under the label that fits it; empty when there is none',
    ),
  user_facing_or_notification_message: z.string().min(1).optional(),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

export type Evidence = z.infer<typeof evidenceSchema>;

/** The same schema for `outputFormat`: draft-07, because the SDK accepts no newer one. */
export const EVALUATION_RESULT_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(
  evaluationResultSchema,
  { target: 'draft-7' },
);
