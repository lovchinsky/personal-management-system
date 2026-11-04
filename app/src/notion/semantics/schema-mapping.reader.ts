import { Injectable, Logger } from '@nestjs/common';
import { messageOf } from '../../platform/error/message-of';
import { Binding } from '../binding/binding';
import { CANONICAL_TYPES } from '../binding/binding.schema';
import { LiveProperty, LiveSchema } from '../client/live-schema';
import { canonicalNotionId } from '../client/notion-id';
import type { PropertyId } from '../client/property-id';
import { needsAttention, notionFailureOf } from './notion-failure';
import { schemaMappingOf, SchemaMappingWire } from './schema-mapping';

/**
 * Reads the mapping for the model, with the names the workspace currently shows
 * (`get_schema_mapping`, `INV-038`). The live schema of each data source is read on every call
 * (`INV-003`) because the person renames properties and options, and the ids stay. A data source
 * that Notion did not return stays without names. The mapping does not become incomplete because
 * of it.
 */
@Injectable()
export class SchemaMappingReader {
  private readonly logger = new Logger(SchemaMappingReader.name);

  constructor(
    private readonly binding: Binding,
    private readonly schema: LiveSchema,
  ) {}

  async read(): Promise<SchemaMappingWire> {
    const live = new Map<string, ReadonlyMap<PropertyId, LiveProperty>>();

    await Promise.all(
      CANONICAL_TYPES.map(async (type) => {
        const dataSourceId = this.binding.dataSource(type);
        const properties = await this.liveOf(dataSourceId);

        if (properties) live.set(canonicalNotionId(dataSourceId), properties);
      }),
    );

    return schemaMappingOf(this.binding, live);
  }

  /**
   * `null` means Notion did not answer, the data source does not exist or access is missing, so
   * the type has no names.
   */
  private async liveOf(
    dataSourceId: string,
  ): Promise<ReadonlyMap<PropertyId, LiveProperty> | null> {
    try {
      return await this.schema.of(dataSourceId);
    } catch (error) {
      if (needsAttention(notionFailureOf(error))) throw error;

      this.logger.warn(`names of data source ${dataSourceId} not read: ${messageOf(error)}`);

      return null;
    }
  }
}
