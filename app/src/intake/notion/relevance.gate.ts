import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PropertyId } from '../../notion/client/property-id';
import { SemanticAdapter } from '../../notion/semantics/semantic.adapter';

/**
 * Slots for which a change to the carrier is worth a run.
 *
 * The list comes from `contracts/canonical.yaml`, key `relevance_gate`. Here it is repeated in a
 * form that can be enumerated at runtime and compared by a test, like `SIGNAL_SLOTS`. The reason
 * the list is one-sided is in `docs/2-system.md` § “Webhook intake”.
 */
export const RELEVANT_SLOTS = [
  'task.status',
  'task.date',
  'task.deadline',
  'task.dependencies',
  'task.project',
  'task.behavior_system',
  'task.area_of_focus',
  'task.key_results',
  'project.status',
  'project.area_of_focus',
  'project.key_results',
  'project.behavior_systems',
  'area_of_focus.mode',
  'behavior_system.lifecycle',
  'behavior_system.supports_key_result',
] as const;

/**
 * Decides whether a change is worth a run.
 *
 * Identifiers are derived from the binding, not listed beside it, because a second list would
 * silently diverge from the first. A slot declared `absent` has no carrier, so the gate does not
 * see it. This shows at startup, not from behavior.
 */
@Injectable()
export class RelevanceGate implements OnModuleInit {
  private readonly logger = new Logger(RelevanceGate.name);

  private watched: ReadonlySet<PropertyId> = new Set();

  constructor(private readonly adapter: SemanticAdapter) {}

  onModuleInit(): void {
    const { ids, unwatchable } = this.adapter.watchedPropertyIds(RELEVANT_SLOTS);

    this.watched = ids;
    this.logger.log(`relevance gate watches ${this.watched.size} properties`);

    if (unwatchable.length > 0) {
      // The level is not `warn`, because a semantic without a carrier is a declared decision of
      // the binding. But it must be reported here. Otherwise a change that should wake the system
      // would silently go unseen by everyone.
      this.logger.log(`relevance gate cannot watch: ${unwatchable.join(', ')}`);
    }
  }

  /**
   * The rule is written over a list of changed property IDs.
   *
   * An event that has no such list does not fall under the rule at all, and that is no reason to
   * reject it. `page.created` **never** has a list, so the rule applied literally would kill the
   * capture path and, with it, any other event without a list. The relevance of such events is
   * decided by their type, not by the intersection.
   */
  matches(updatedProperties: readonly PropertyId[]): boolean {
    return updatedProperties.some((id) => this.watched.has(id));
  }
}
