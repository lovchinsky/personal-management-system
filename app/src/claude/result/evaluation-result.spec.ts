import { z } from 'zod';
import { aResult } from '../../../test/fixtures/claude-stream.fixture';
import { DETECTOR_LABELS } from './detector-labels';
import { EVALUATION_RESULT_JSON_SCHEMA, evaluationResultSchema } from './evaluation-result';

/** The detection of a valid result with one change: what each case checks. */
function withDetection(patch: Record<string, unknown>): unknown {
  const [first] = aResult().detections;

  return { ...aResult(), detections: [{ ...first, ...patch }] };
}

/** The part of the JSON Schema the model sees: the rules and the field descriptions. */
const jsonShape = z.object({
  properties: z.object({
    outcome: z.object({ pattern: z.string(), description: z.string() }),
    detections: z.object({
      description: z.string(),
      items: z.object({
        properties: z.object({
          type: z.object({ enum: z.array(z.string()), description: z.string() }),
          why_now: z.object({ description: z.string() }),
          evidence: z.object({
            minItems: z.literal(1),
            items: z.object({
              properties: z.object({ ref: z.object({ description: z.string() }) }),
            }),
          }),
          counterevidence_checked: z.object({ minItems: z.literal(1), description: z.string() }),
        }),
      }),
    }),
  }),
});

describe('evaluationResultSchema', () => {
  it('accepts a result with a contract label, evidence and counterevidence', () => {
    expect(evaluationResultSchema.safeParse(aResult()).success).toBe(true);
  });

  it.each(DETECTOR_LABELS)('accepts the label `%s`', (type) => {
    expect(evaluationResultSchema.safeParse(withDetection({ type })).success).toBe(true);
  });

  it.each([
    ['label outside the contract', { type: 'gate_check' }],
    ['invented label', { type: 'prompt_injection' }],
    ['no evidence', { evidence: [] }],
    ['evidence without an identifier', { evidence: [{ server: 'notion', ref: '' }] }],
    ['no counterevidence', { counterevidence_checked: [] }],
    ['empty string instead of counterevidence', { counterevidence_checked: [''] }],
  ])('rejects a detection: %s', (_, patch) => {
    expect(evaluationResultSchema.safeParse(withDetection(patch)).success).toBe(false);
  });

  it.each(['Inbox item clarified', 'noAction', 'no__action', 'no_action_', '_no_action', ''])(
    'rejects the outcome “%s”',
    (outcome) => {
      expect(evaluationResultSchema.safeParse({ ...aResult(), outcome }).success).toBe(false);
    },
  );

  it.each(['no_action', 'attention_raised', 'inbox_item_closed_duplicate', 'recheck_2'])(
    'accepts the outcome “%s”',
    (outcome) => {
      expect(evaluationResultSchema.safeParse({ ...aResult(), outcome }).success).toBe(true);
    },
  );

  it('accepts empty `detections` as a complete result', () => {
    expect(evaluationResultSchema.safeParse({ ...aResult(), detections: [] }).success).toBe(true);
  });
});

describe('EVALUATION_RESULT_JSON_SCHEMA', () => {
  const { properties } = jsonShape.parse(EVALUATION_RESULT_JSON_SCHEMA);
  const detection = properties.detections.items.properties;

  it('includes what the CLI validates: the list of labels, the minimums and the outcome pattern', () => {
    expect(detection.type.enum).toEqual([...DETECTOR_LABELS]);
    expect(new RegExp(properties.outcome.pattern).test('no_action')).toBe(true);
    expect(new RegExp(properties.outcome.pattern).test('No action')).toBe(false);
  });

  it('includes the field descriptions the model sees when it composes the result', () => {
    expect(
      [
        properties.outcome.description,
        properties.detections.description,
        detection.type.description,
        detection.why_now.description,
        detection.evidence.items.properties.ref.description,
        detection.counterevidence_checked.description,
      ].every((description) => description.length > 0),
    ).toBe(true);
  });
});
