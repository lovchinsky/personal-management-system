import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { canonical } from './contracts';

/**
 * `INV-207` **Change mechanisms.** A Project and a Behavior System are different L1 mechanisms: a
 * Project has five canonical statuses, a Behavior System has five lifecycle states, and they do
 * not overlap. A Behavior System is the definition of a behavior; a Task is a single execution of
 * it.
 */
describe('INV-207', () => {
  it('a Project has five statuses, a Behavior System has five lifecycle states', () => {
    const project = VALID_BINDING_FILE.options['project.status']?.canonical;
    const lifecycle = VALID_BINDING_FILE.options['behavior_system.lifecycle']?.canonical;

    expect(Object.keys(project ?? {})).toHaveLength(5);
    expect(Object.keys(lifecycle ?? {})).toHaveLength(5);
  });

  it('the sets do not overlap: they are different mechanisms, not two names for one', () => {
    const project = Object.keys(VALID_BINDING_FILE.options['project.status']?.canonical ?? {});
    const lifecycle = Object.keys(
      VALID_BINDING_FILE.options['behavior_system.lifecycle']?.canonical ?? {},
    );

    expect(project.filter((status) => lifecycle.includes(status))).toEqual([]);
  });

  it('a repetition exists as a Task: the tracking of a Behavior System is derived from instances', () => {
    expect(canonical.fieldContract().behavior_system.tracking).toBe('derived_from_task_instances');
  });
});
