import { RELEVANT_SLOTS } from '../../src/intake/notion/relevance.gate';
import { bindingOf } from '../../src/notion/binding/binding';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { canonical } from './contracts';

/**
 * The relevance gate and the contract describe the same list, and every name in it has a carrier
 * with a property ID.
 *
 * The second check matters more: a gate that derives identifiers from the binding silently
 * narrows on every slot that has become `absent`. The test makes that narrowing visible in CI.
 */
describe('the relevance gate and the contract', () => {
  const declared = canonical.relevanceGate().slots;

  it('the list of slots matches', () => {
    expect([...RELEVANT_SLOTS]).toEqual(declared);
  });

  it('every slot addresses an existing canonical type and field', () => {
    const fieldContract = canonical.fieldContract();

    for (const slot of RELEVANT_SLOTS) {
      const [type, field] = slot.split('.');

      expect(fieldContract[type]).toBeDefined();
      expect(Object.keys(fieldContract[type])).toContain(field);
    }
  });

  it('every slot has a carrier with a property ID, in the form the binding uses', () => {
    const carriers = new Map(
      bindingOf(VALID_BINDING_FILE, 'fixture').fields.map(({ slot, carrier }) => [slot, carrier]),
    );

    for (const slot of RELEVANT_SLOTS) {
      expect(['native', 'relation']).toContain(carriers.get(slot)?.kind);
    }
  });

  /**
   * One-sidedness: no pair of slots describes the two sides of one relation. Otherwise one action
   * by the person would produce two runs, one per page.
   */
  it('the list does not contain both sides of one relation', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['task.project', 'project.tasks'],
      ['task.behavior_system', 'behavior_system.tasks'],
      ['task.key_results', 'key_result.tasks'],
      ['project.key_results', 'key_result.supporting_projects'],
      ['behavior_system.supports_key_result', 'key_result.supporting_behavior_systems'],
    ];

    for (const [owned, mirror] of pairs) {
      const slots: readonly string[] = RELEVANT_SLOTS;

      expect(slots).toContain(owned);
      expect(slots).not.toContain(mirror);
    }
  });
});
