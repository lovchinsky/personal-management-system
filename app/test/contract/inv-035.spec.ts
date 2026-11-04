import { z } from 'zod';
import {
  EVALUATION_RESULT_JSON_SCHEMA,
  evaluationResultSchema,
} from '../../src/claude/result/evaluation-result';
import { DEFAULT_RUN_PROFILE } from '../../src/claude/run-profile';
import { classify } from '../../src/claude/runner/run-classifier';
import { RunObserver } from '../../src/claude/runner/run-observer';
import {
  aResult,
  initMessage,
  PLUGIN_DIR,
  resultMessage,
  toolResult,
  toolUse,
} from '../fixtures/claude-stream.fixture';
import { canonical } from './contracts';

function statusOf(overrides: Record<string, unknown>): string {
  const observer = new RunObserver(
    () => [],
    () => undefined,
    PLUGIN_DIR,
  );

  for (const message of [
    initMessage('run-1'),
    toolUse('t1', 'mcp__notion__notion-fetch'),
    toolResult('t1', 'page-read-1'),
    resultMessage('run-1', overrides),
  ]) {
    observer.see(message);
  }

  return classify({
    runId: 'run-1',
    profile: DEFAULT_RUN_PROFILE,
    observed: observer.observed(),
    deadlineReached: false,
    notionUnavailableAtInit: false,
    redact: (text) => text,
    pluginDigest: '0a1b2c3d4e5f',
  }).status;
}

/** A tree of a shape's keys: `null` marks a leaf, an object holds the nested keys. */
type KeyTree = null | { readonly [key: string]: KeyTree };

/**
 * A node of the contract's shape reduced to a key tree: `field`, `array` and `presence` become
 * leaves, a nested object becomes its keys, `array_of_objects` becomes the keys of its element.
 */
const contractKeys: z.ZodType<KeyTree> = z.lazy(() =>
  z.union([
    z.enum(['field', 'array']).transform(() => null),
    z.strictObject({ presence: z.string() }).transform(() => null),
    z
      .strictObject({
        kind: z.literal('array_of_objects'),
        item: z.record(z.string(), contractKeys),
      })
      .transform(({ item }) => item),
    z.record(z.string(), contractKeys),
  ]),
);

interface SchemaNode {
  readonly type?: string;
  readonly properties?: { readonly [key: string]: SchemaNode };
  readonly items?: SchemaNode;
}

const schemaNode: z.ZodType<SchemaNode> = z.lazy(() =>
  z.looseObject({
    type: z.string().optional(),
    properties: z.record(z.string(), schemaNode).optional(),
    items: schemaNode.optional(),
  }),
);

/**
 * Returns the keys of a JSON Schema: an array of objects yields the keys of its element, and the
 * other leaves are `null`.
 */
function schemaKeys(node: SchemaNode): KeyTree {
  const target = node.type === 'array' && node.items ? node.items : node;

  return target.properties
    ? Object.fromEntries(
        Object.entries(target.properties).map(([key, child]) => [key, schemaKeys(child)]),
      )
    : null;
}

/**
 * Returns a result with one change in its detection: a way in which a result could violate the
 * content of the schema.
 */
function withDetection(patch: Record<string, unknown>): unknown {
  const [first] = aResult().detections;

  return { ...aResult(), detections: [{ ...first, ...patch }] };
}

/**
 * `INV-035` The SDK validates the evaluation result through `outputFormat` (draft-07), and the
 * App validates it once more with its own schema; a run without a valid `structured_output` is a
 * failure, and the failure is reported by `is_error` and `terminal_reason`, not by `subtype`.
 * The schema enforces the content too: a detection's type is a label from the contract, the
 * evidence and counterevidence are non-empty, `outcome` is snake_case (ADR 0033).
 * An invalid result leaves no App effects, and the dispatcher enforces that
 * (`run.dispatcher.spec.ts`). The system's writes to Notion and to GBrain memory go through the
 * App and wait for that same conclusion of the run (`INV-088`).
 */
describe('INV-035', () => {
  const declared = canonical.evaluationResult().shape;

  it("the result schema has exactly the contract's fields", () => {
    expect(Object.keys(evaluationResultSchema.shape).sort()).toEqual(Object.keys(declared).sort());
  });

  /**
   * The check covers the nested keys, not only the top level, because the contract describes the
   * keys of `scope`, `detections[]` and `evidence[]` just as precisely. A mismatch in a nested key
   * is also a mismatch in the shape that the CLI checks against the schema.
   */
  it('the nested keys of the schema are exactly the nested keys of the contract', () => {
    const contract = contractKeys.parse(declared);
    const schema = schemaKeys(schemaNode.parse(EVALUATION_RESULT_JSON_SCHEMA));

    expect(schema).toEqual(contract);
    expect(schema).toMatchObject({
      scope: { object_type: null, object_id: null },
      detections: { type: null, evidence: { server: null, ref: null } },
    });
  });

  it("the schema's operating loop phases equal the contract's operating_loop, in its order", () => {
    const phases = z
      .object({
        properties: z.object({
          operating_phase: z.object({ items: z.object({ enum: z.array(z.string()) }) }),
        }),
      })
      .parse(EVALUATION_RESULT_JSON_SCHEMA).properties.operating_phase.items.enum;

    expect(phases).toEqual(canonical.operatingLoop());
  });

  it('the JSON Schema for `outputFormat` is draft-07', () => {
    expect(EVALUATION_RESULT_JSON_SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('a valid result is accepted', () => {
    expect(statusOf({})).toBe('completed');
  });

  it.each([
    ['missing structured output', { structured_output: undefined }],
    ['a result outside the schema', { structured_output: { ...aResult(), extra: true } }],
    ['a label outside the contract', { structured_output: withDetection({ type: 'gate_check' }) }],
    ['a detection without evidence', { structured_output: withDetection({ evidence: [] }) }],
    [
      'a detection without counterevidence',
      { structured_output: withDetection({ counterevidence_checked: [] }) },
    ],
    [
      '`outcome` in prose',
      { structured_output: { ...aResult(), outcome: 'Inbox item clarified' } },
    ],
    ['success with `is_error`', { is_error: true, terminal_reason: 'api_error' }],
    ['success without `completed`', { terminal_reason: 'max_turns' }],
  ])('%s is a failure', (_, overrides) => {
    expect(statusOf(overrides)).toBe('failed');
  });
});
