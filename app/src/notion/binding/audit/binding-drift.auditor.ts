import { Injectable, Logger } from '@nestjs/common';
import { messageOf } from '../../../platform/error/message-of';
import { LiveProperty, LiveSchema } from '../../client/live-schema';
import {
  isNotionUnavailable,
  isObjectNotFound,
  NotionAccessError,
} from '../../client/notion.error';
import { PropertyId } from '../../client/property-id';
import { Binding, propertyOf } from '../binding';
import { CANONICAL_TYPES } from '../binding.schema';

interface Drift {
  /** The full name of a slot or signal: `task.status`. */
  readonly slot: string;
  readonly detail: string;
}

interface DriftReport {
  readonly checked: number;
  readonly drifts: readonly Drift[];
  /** Data sources that could not be read. That is unavailability, not drift. */
  readonly unreachable: readonly string[];
}

/**
 * Checks whether the binding has diverged from the live workspace, which means finding a dead id
 * that the startup check does not see (`docs/2-system.md` § “Onboarding mapping”). It checks
 * exactly what the binding declares as a carrier.
 */
@Injectable()
export class BindingDriftAuditor {
  private readonly logger = new Logger(BindingDriftAuditor.name);

  constructor(
    private readonly schema: LiveSchema,
    private readonly binding: Binding,
  ) {}

  async audit(): Promise<DriftReport> {
    const drifts: Drift[] = [];
    const unreachable: string[] = [];
    let checked = 0;

    for (const type of CANONICAL_TYPES) {
      const dataSourceId = this.binding.dataSource(type);
      const live = await this.propertiesOf(dataSourceId);

      if (live === 'gone') {
        drifts.push({
          slot: `data_sources.${type}`,
          detail: `data source ${dataSourceId} is gone`,
        });
        continue;
      }

      if (!live) {
        unreachable.push(`${type} (${dataSourceId})`);
        continue;
      }

      for (const { slot, carrier } of this.binding.fieldsOf(type)) {
        const bound = propertyOf(carrier);
        if (!bound) {
          continue;
        }

        checked += 1;

        const property = live.get(bound.id);
        if (!property) {
          drifts.push({ slot, detail: `property ${bound.spelled} is gone` });
          continue;
        }

        drifts.push(...this.optionDrift(slot, property));
      }

      for (const { slot, property } of this.binding.signalsOf(type)) {
        checked += 1;

        if (!live.get(property.id)) {
          drifts.push({ slot, detail: `signal property ${property.spelled} is gone` });
        }
      }
    }

    if (drifts.length > 0) {
      this.logger.warn(
        `binding drifted from workspace: ${drifts.map((drift) => `${drift.slot} — ${drift.detail}`).join('; ')}`,
      );
    } else if (unreachable.length > 0) {
      this.logger.warn(
        `binding checked in part: ${checked} carriers checked, unreachable: ${unreachable.join(', ')}`,
      );
    } else {
      this.logger.log(`binding matches workspace: ${checked} carriers checked`);
    }

    return { checked, drifts, unreachable };
  }

  /**
   * Checks the options of a closed set separately, because a vanished status option is the case
   * where the file stays complete while the detector stops finding what it filters on.
   */
  private optionDrift(slot: string, property: LiveProperty): readonly Drift[] {
    const declared = this.binding.optionSet(slot);
    if (!declared) {
      return [];
    }

    const live = new Set(property.options ?? []);

    // Non-canonical values are checked too: `Hidden` and `Failed` are registered because the
    // detector must recognize them rather than ask the model about them.
    const all = [...declared.canonical, ...declared.knownNonCanonical];

    return all.flatMap(([option, optionId]) =>
      live.has(optionId)
        ? []
        : [{ slot: `${slot}:${option}`, detail: `option ${optionId} is gone` }],
    );
  }

  /**
   * Returns the properties of a data source. `'gone'` means Notion says the data source does not
   * exist, so the binding's id is dead, and that is drift. `null` means Notion did not answer or
   * access is missing. That is not drift, because the binding may not have changed. Any other
   * error is a defect and propagates.
   */
  private async propertiesOf(
    dataSourceId: string,
  ): Promise<ReadonlyMap<PropertyId, LiveProperty> | 'gone' | null> {
    try {
      return await this.schema.of(dataSourceId);
    } catch (error) {
      if (isObjectNotFound(error)) return 'gone';

      if (!isNotionUnavailable(error) && !(error instanceof NotionAccessError)) throw error;

      this.logger.warn(`data source ${dataSourceId} unreachable: ${messageOf(error)}`);

      return null;
    }
  }
}
