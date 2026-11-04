import { Test } from '@nestjs/testing';
import {
  TASK_STATUS_SPELLED,
  VALID_BINDING_FILE,
} from '../../../test/fixtures/notion-mapping.fixture';
import { bindingProvider } from '../../../test/fixtures/test-module';
import { BindingFile } from '../../notion/binding/binding.schema';
import { PropertyId, propertyIdFromNotion } from '../../notion/client/property-id';
import { SemanticAdapter } from '../../notion/semantics/semantic.adapter';
import { RelevanceGate, RELEVANT_SLOTS } from './relevance.gate';

/**
 * Builds a gate from the binding, not a list checked against the binding.
 *
 * The neighboring contract check reads the same fixture the gate derives its identifiers from,
 * and so does not see what it promises to see: narrowing. Here a real `RelevanceGate` is built
 * and asked what the runtime asks: `matches()`.
 */
async function gateOver(binding: BindingFile): Promise<RelevanceGate> {
  return (await watchersOver(binding)).gate;
}

/** Builds the gate together with the adapter it takes the watched properties from. */
async function watchersOver(
  binding: BindingFile,
): Promise<{ readonly gate: RelevanceGate; readonly adapter: SemanticAdapter }> {
  const moduleRef = await Test.createTestingModule({
    providers: [RelevanceGate, SemanticAdapter, bindingProvider(binding)],
  }).compile();

  await moduleRef.init();

  return { gate: moduleRef.get(RelevanceGate), adapter: moduleRef.get(SemanticAdapter) };
}

/** Passes IDs from the event through the same translation as the webhook schema. */
function changed(...wire: string[]): PropertyId[] {
  return wire.map((id) => propertyIdFromNotion(id));
}

/**
 * Builds a binding in which the Task status, a watched slot, has lost its carrier, and with it the
 * set of option ids, because the set exists only for a field bound as `native`.
 */
function withoutStatusCarrier(): BindingFile {
  return {
    ...VALID_BINDING_FILE,
    fields: {
      ...VALID_BINDING_FILE.fields,
      task: {
        ...VALID_BINDING_FILE.fields.task,
        status: { kind: 'absent', reason: 'carrier removed in this fixture' },
      },
    },
    options: { ...VALID_BINDING_FILE.options, 'task.status': undefined },
  };
}

describe('relevance gate over a live binding', () => {
  it('watches every slot of the list', async () => {
    const { gate, adapter } = await watchersOver(VALID_BINDING_FILE);
    const { ids, unwatchable } = adapter.watchedPropertyIds(RELEVANT_SLOTS);

    expect(unwatchable).toEqual([]);
    expect([...ids].filter((id) => !gate.matches([id]))).toEqual([]);
  });

  /**
   * This is what the check exists for: a slot without a carrier silently stops being watched, and
   * a change that should wake the system stops waking it.
   */
  it('a slot that has lost its carrier is no longer watched', async () => {
    const { gate, adapter } = await watchersOver(withoutStatusCarrier());

    expect(adapter.watchedPropertyIds(RELEVANT_SLOTS).unwatchable).toEqual(['task.status']);
    expect(gate.matches(changed(TASK_STATUS_SPELLED))).toBe(false);
  });

  it('a change to a watched property is worth a run', async () => {
    const gate = await gateOver(VALID_BINDING_FILE);

    expect(gate.matches(changed(TASK_STATUS_SPELLED))).toBe(true);
  });

  it('a change to a property outside the list is not worth a run', async () => {
    const gate = await gateOver(VALID_BINDING_FILE);

    expect(gate.matches(changed('p_task_result_or_note'))).toBe(false);
  });

  /**
   * The binding keeps ids in percent-encoded form, and the form in the event is not measured:
   * Notion's official example is encoded, and no measurement tells the forms apart. Without the
   * translation the intersection would be empty on the identifiers that matter most, because
   * statuses and relations in Notion have ids of this kind.
   */
  it('an id from the event matches the binding in either of the two forms', async () => {
    const gate = await gateOver(VALID_BINDING_FILE);

    expect(gate.matches(changed('r_task%7Bdependencies'))).toBe(true);
    expect(gate.matches(changed('r_task{dependencies'))).toBe(true);
  });

  it('an event without a property list falls outside the rule', async () => {
    const gate = await gateOver(VALID_BINDING_FILE);

    expect(gate.matches([])).toBe(false);
  });
});
