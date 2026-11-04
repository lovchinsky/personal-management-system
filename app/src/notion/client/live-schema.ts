import { Injectable } from '@nestjs/common';
import { Client, isFullDataSource, type DataSourceObjectResponse } from '@notionhq/client';
import { NotionAccessError } from './notion.error';
import { PropertyId, propertyIdFromNotion } from './property-id';
import { PhysicalTypes, physicalTypes } from './property-write';

/** A data source property as it currently is in the workspace. */
export interface LiveProperty {
  readonly type: string;
  /** The name the workspace currently shows: the Notion MCP uses it to refer to the property. */
  readonly name: string;
  /** The option ids of the closed set, for a status and a select. */
  readonly options?: readonly string[];
  /**
   * The current name of each option, by its id. A Notion query filter accepts the name, but the
   * contract is the id: the name is taken here when the query is made, because the person renames
   * options.
   */
  readonly optionNames?: ReadonlyMap<string, string>;
}

/**
 * Reads the schema of a data source from the live workspace: which properties it has and of what
 * type.
 *
 * It caches nothing, because a type that changed in the workspace must be visible to whoever is
 * currently writing, and the binding check must see today's schema, not yesterday's.
 */
@Injectable()
export class LiveSchema {
  constructor(private readonly notion: Client) {}

  async of(dataSourceId: string): Promise<ReadonlyMap<PropertyId, LiveProperty>> {
    const response = await this.notion.dataSources.retrieve({ data_source_id: dataSourceId });

    if (!isFullDataSource(response)) {
      throw new NotionAccessError(
        `data source ${dataSourceId}`,
        'the integration has no access to its schema',
      );
    }

    const properties = new Map<PropertyId, LiveProperty>();

    for (const property of Object.values(response.properties)) {
      const options = optionsOf(property);

      properties.set(propertyIdFromNotion(property.id), {
        type: property.type,
        name: property.name,
        options: options?.map((option) => option.id),
        optionNames: options && new Map(options.map((option) => [option.id, option.name])),
      });
    }

    return properties;
  }

  /**
   * Returns only the types, which determine how a write to pages of this data source is encoded.
   */
  async typesOf(dataSourceId: string): Promise<PhysicalTypes> {
    return physicalTypes(await this.of(dataSourceId));
  }
}

/** Returns the options of the closed set. Only a status and a select have them. */
function optionsOf(
  property: DataSourceObjectResponse['properties'][string],
): readonly { readonly id: string; readonly name: string }[] | undefined {
  if (property.type === 'status') return property.status.options;

  if (property.type === 'select') return property.select.options;

  return undefined;
}
