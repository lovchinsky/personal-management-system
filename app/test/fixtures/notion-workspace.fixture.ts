import type { DataSourceObjectResponse } from '@notionhq/client';
import { fullDataSource, type LivePropertyConfig } from './notion-data-source.fixture';

/** Builds a data source with a database title, as `dataSources.retrieve` returns it. */
export function titledDataSource(
  id: string,
  title: string,
  properties: readonly LivePropertyConfig[],
): DataSourceObjectResponse {
  return {
    ...fullDataSource(id, properties),
    title: [
      {
        type: 'text',
        text: { content: title, link: null },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: title,
        href: null,
      },
    ],
  };
}

/** Builds a relation to `target`: two-way when a paired property is named, otherwise one-way. */
export function relationTo(
  id: string,
  name: string,
  target: string,
  synced?: string,
): LivePropertyConfig {
  return {
    id,
    name,
    description: null,
    type: 'relation',
    relation:
      synced === undefined
        ? {
            database_id: `db-${target}`,
            data_source_id: target,
            type: 'single_property',
            single_property: {},
          }
        : {
            database_id: `db-${target}`,
            data_source_id: target,
            type: 'dual_property',
            dual_property: { synced_property_id: `${synced}-id`, synced_property_name: synced },
          },
  };
}

/** Builds a formula with an expression. */
export function formulaOf(id: string, name: string, expression: string): LivePropertyConfig {
  return { id, name, description: null, type: 'formula', formula: { expression } };
}

/** Builds a select with options `[name, color]`. */
export function selectOf(
  id: string,
  name: string,
  options: readonly (readonly [string, 'gray' | 'blue' | 'green'])[],
): LivePropertyConfig {
  return {
    id,
    name,
    description: null,
    type: 'select',
    select: {
      options: options.map(([option, color]) => ({
        id: `${id}-${option}`,
        name: option,
        color,
        description: null,
      })),
    },
  };
}
