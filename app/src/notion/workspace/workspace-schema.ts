import {
  APIErrorCode,
  isFullDataSource,
  isNotionClientError,
  type Client,
  type DataSourceObjectResponse,
} from '@notionhq/client';

type LiveProperty = DataSourceObjectResponse['properties'][string];
type NumberFormat = Extract<LiveProperty, { type: 'number' }>['number']['format'];
type RollupFunction = Extract<LiveProperty, { type: 'rollup' }>['rollup']['function'];
type SelectColor = Extract<LiveProperty, { type: 'select' }>['select']['options'][number]['color'];
type NoticonColor = Extract<
  NonNullable<DataSourceObjectResponse['icon']>,
  { type: 'icon' }
>['icon']['color'];

/** Types without settings of their own: a property is fully defined by its name and type. */
export type PlainType =
  | 'title'
  | 'rich_text'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'files'
  | 'people'
  | 'created_by'
  | 'created_time'
  | 'last_edited_by'
  | 'last_edited_time';

export const PLAIN_TYPES = [
  'title',
  'rich_text',
  'date',
  'checkbox',
  'url',
  'email',
  'phone_number',
  'files',
  'people',
  'created_by',
  'created_time',
  'last_edited_by',
  'last_edited_time',
] as const satisfies readonly PlainType[];

interface OptionShape {
  readonly name: string;
  readonly color: SelectColor;
  readonly description: string | null;
}

/**
 * A property without an id: what the schema reproduces and checks. A relation names its target
 * database by title, because ids differ between two workspaces while database titles are the same.
 *
 * Status groups are not included: REST does not set them, and they have no semantics in the
 * system.
 */
export type PropertyShape = { readonly description: string | null } & (
  | { readonly type: PlainType }
  | { readonly type: 'number'; readonly format: NumberFormat }
  | {
      readonly type: 'select' | 'multi_select' | 'status';
      readonly options: readonly OptionShape[];
    }
  | { readonly type: 'relation'; readonly target: string; readonly synced: string | null }
  | {
      readonly type: 'rollup';
      readonly relation: string;
      readonly rollup: string;
      readonly function: RollupFunction;
    }
  | { readonly type: 'formula'; readonly expression: string }
  | { readonly type: 'unique_id'; readonly prefix: string | null }
);

/** An icon that can be set in any workspace. */
export type IconShape =
  | { readonly type: 'emoji'; readonly emoji: string }
  | { readonly type: 'icon'; readonly name: string; readonly color: NoticonColor }
  | { readonly type: 'external'; readonly url: string };

/**
 * A database without an id: the title is its key in the target, and the target is a list of
 * databases without ids.
 */
export interface DatabaseShape {
  readonly title: string;
  readonly icon: IconShape | null;
  readonly description: string;
  /** Properties by name: a name is unique within a database. */
  readonly properties: ReadonlyMap<string, PropertyShape>;
}

/** A database of the live workspace: its shape and the ids that workspace itself uses for it. */
export interface LiveDatabase {
  readonly dataSourceId: string;
  readonly shape: DatabaseShape;
  /** The property id by name, as REST returns it. */
  readonly propertyIds: ReadonlyMap<string, string>;
  /** The option id by name, for each property with options. */
  readonly optionIds: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** The databases of the live workspace by data source id. */
export type Workspace = ReadonlyMap<string, LiveDatabase>;

type ReadDataSource = (dataSourceId: string) => Promise<DataSourceObjectResponse>;

/** Reads a data source's schema with a client that must see it in full. */
export function dataSourceReader(client: Client, who: string): ReadDataSource {
  return async (dataSourceId) => {
    const response = await client.dataSources.retrieve({ data_source_id: dataSourceId });

    if (!isFullDataSource(response)) {
      throw new Error(`${who} cannot read the schema of data source ${dataSourceId}`);
    }

    return response;
  };
}

/**
 * Returns the titles of the ledger's databases the client does not see. A top-level database is
 * opened to the integration by the person, in the integration's settings. There is no
 * programmatic path for opening it.
 */
export async function unseenDatabases(
  notion: Client,
  built: ReadonlyMap<string, string>,
): Promise<string[]> {
  const titles: string[] = [];

  for (const [title, dataSourceId] of built) {
    try {
      const response = await notion.dataSources.retrieve({ data_source_id: dataSourceId });

      if (isFullDataSource(response)) continue;
    } catch (error) {
      if (
        !isNotionClientError(error) ||
        (error.code !== APIErrorCode.ObjectNotFound &&
          error.code !== APIErrorCode.RestrictedResource)
      ) {
        throw error;
      }
    }

    titles.push(title);
  }

  return titles;
}

/** Returns the identifier of the workspace the client's token belongs to. */
export async function workspaceIdOf(client: Client, who: string): Promise<string> {
  const me = await client.users.me({});

  if (me.type !== 'bot' || !('workspace_id' in me.bot)) {
    throw new Error(`${who} is not a bot of a workspace`);
  }

  return me.bot.workspace_id;
}

/**
 * Reads the workspace schema from `roots` together with all databases their relations lead to. A
 * reference database that a bound database refers to is part of the same schema.
 */
export async function readWorkspace(
  read: ReadDataSource,
  roots: readonly string[],
): Promise<Workspace> {
  return workspaceOf(await readDataSources(read, roots, 'linked'));
}

/**
 * Reads the data sources from `roots`, as REST returns them. `linked` follows their relations
 * further. `listed` reads only the named ones, because whoever changes databases need not read
 * foreign ones.
 */
export async function readDataSources(
  read: ReadDataSource,
  roots: readonly string[],
  scope: 'linked' | 'listed',
): Promise<Map<string, DataSourceObjectResponse>> {
  const responses = new Map<string, DataSourceObjectResponse>();
  const queue = [...roots];

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (responses.has(id)) continue;

    const response = await read(id);

    responses.set(id, response);

    if (scope === 'listed') continue;

    for (const property of Object.values(response.properties)) {
      if (property.type === 'relation') queue.push(property.relation.data_source_id);
    }
  }

  return responses;
}

/**
 * Builds the workspace schema from the data sources that were read. A relation names its target by
 * the title of its database, so database titles must be unique, and the target must be among the
 * data sources read.
 */
export function workspaceOf(responses: ReadonlyMap<string, DataSourceObjectResponse>): Workspace {
  const titles = new Map([...responses].map(([id, response]) => [id, plain(response.title)]));
  const repeated = [...titles.values()].filter((title, index, all) => all.indexOf(title) !== index);

  if (repeated.length > 0) {
    throw new Error(
      `database titles repeat (${[...new Set(repeated)].join(', ')}): a relation could not name its target`,
    );
  }

  return new Map(
    [...responses].map(([id, response]) => [
      id,
      liveDatabaseOf(response, (target) => titles.get(target)),
    ]),
  );
}

function liveDatabaseOf(
  response: DataSourceObjectResponse,
  titleOf: (dataSourceId: string) => string | undefined,
): LiveDatabase {
  const title = plain(response.title);
  const properties = new Map<string, PropertyShape>();
  const propertyIds = new Map<string, string>();
  const optionIds = new Map<string, ReadonlyMap<string, string>>();

  for (const property of Object.values(response.properties)) {
    properties.set(property.name, shapeOf(property, title, titleOf));
    propertyIds.set(property.name, property.id);

    const options = optionsOf(property);

    if (options) {
      optionIds.set(property.name, new Map(options.map((option) => [option.name, option.id])));
    }
  }

  return {
    dataSourceId: response.id,
    shape: { ...lookOf(response), properties },
    propertyIds,
    optionIds,
  };
}

/** Returns a database's look: title, icon, description, what it has besides properties. */
export function lookOf(response: DataSourceObjectResponse): Omit<DatabaseShape, 'properties'> {
  return {
    title: plain(response.title),
    icon: iconOf(response.icon),
    description: plain(response.description),
  };
}

function shapeOf(
  property: LiveProperty,
  database: string,
  titleOf: (dataSourceId: string) => string | undefined,
): PropertyShape {
  const description = property.description || null;
  const options = optionsOf(property)?.map(({ name, color, description: text }) => ({
    name,
    color,
    description: text || null,
  }));

  switch (property.type) {
    case 'number':
      return { description, type: 'number', format: property.number.format };

    case 'select':
    case 'multi_select':
    case 'status':
      return { description, type: property.type, options: options ?? [] };

    case 'relation': {
      const target = titleOf(property.relation.data_source_id);

      if (target === undefined) {
        throw new Error(
          `${database}."${property.name}" relates to a data source outside the schema`,
        );
      }

      return {
        description,
        type: 'relation',
        target,
        synced:
          property.relation.type === 'dual_property'
            ? property.relation.dual_property.synced_property_name
            : null,
      };
    }

    case 'rollup':
      return {
        description,
        type: 'rollup',
        relation: property.rollup.relation_property_name,
        rollup: property.rollup.rollup_property_name,
        function: property.rollup.function,
      };

    case 'formula':
      return { description, type: 'formula', expression: property.formula.expression };

    case 'unique_id':
      return { description, type: 'unique_id', prefix: property.unique_id.prefix };

    default: {
      // REST also returns a type the SDK does not know, and the reason for the refusal needs its
      // name.
      const type: string = property.type;

      if (isPlain(property.type)) return { description, type: property.type };

      throw new Error(
        `${database}."${property.name}" has type ${type}, which a database shape does not describe`,
      );
    }
  }
}

function isPlain(type: string): type is PlainType {
  return (PLAIN_TYPES as readonly string[]).includes(type);
}

function optionsOf(property: LiveProperty):
  | readonly {
      readonly id: string;
      readonly name: string;
      readonly color: SelectColor;
      readonly description: string | null;
    }[]
  | undefined {
  if (property.type === 'select') return property.select.options;
  if (property.type === 'multi_select') return property.multi_select.options;
  if (property.type === 'status') return property.status.options;

  return undefined;
}

/**
 * Returns an icon that can be described; an uploaded file and a custom emoji belong to the
 * workspace they were uploaded to.
 */
function iconOf(icon: DataSourceObjectResponse['icon']): IconShape | null {
  if (icon?.type === 'emoji') return { type: 'emoji', emoji: icon.emoji };
  if (icon?.type === 'icon') return { type: 'icon', name: icon.icon.name, color: icon.icon.color };
  if (icon?.type === 'external') return { type: 'external', url: icon.external.url };

  return null;
}

function plain(text: readonly { readonly plain_text: string }[]): string {
  return text.map((part) => part.plain_text).join('');
}

/**
 * Describes how the live workspace differs from the target, a line per difference. Formula
 * expressions are not included, because the person enters them and `formulasToEnter` checks them.
 */
export function differences(target: readonly DatabaseShape[], live: Workspace): string[] {
  const liveByTitle = shapesByTitle(live);
  const found: string[] = [];

  for (const expected of target) {
    const actual = liveByTitle.get(expected.title);

    if (actual === undefined) found.push(`database ${expected.title} is missing`);
    else found.push(...databaseDifferences(expected, actual));
  }

  const titles = new Set(target.map(({ title }) => title));

  for (const title of liveByTitle.keys()) {
    if (!titles.has(title)) found.push(`database ${title} is not in the target`);
  }

  return found;
}

function databaseDifferences(expected: DatabaseShape, actual: DatabaseShape): string[] {
  const { title } = expected;
  const found: string[] = [];

  if (describe(expected.icon) !== describe(actual.icon)) found.push(`${title}: the icon differs`);
  if (expected.description !== actual.description) found.push(`${title}: the description differs`);

  for (const [name, property] of expected.properties) {
    const other = actual.properties.get(name);

    if (other === undefined) found.push(`${title}."${name}" is missing`);
    else if (!sameProperty(property, other)) {
      found.push(
        `${title}."${name}" differs: ${describe(structure(property))} expected, ` +
          `${describe(structure(other))} found`,
      );
    }
  }

  for (const name of actual.properties.keys()) {
    if (!expected.properties.has(name)) found.push(`${title}."${name}" is not in the target`);
  }

  return found;
}

/** Returns the databases of the live workspace by title. */
export function shapesByTitle(live: Workspace): Map<string, DatabaseShape> {
  return new Map([...live.values()].map(({ shape }) => [shape.title, shape]));
}

/**
 * Checks whether the properties have the same structure, leaving out the formula expression. The
 * order of options is set by status groups, which REST does not set, so options are compared as a
 * set.
 */
export function sameProperty(a: PropertyShape, b: PropertyShape): boolean {
  return describe(comparable(a)) === describe(comparable(b));
}

function comparable(property: PropertyShape): PropertyShape {
  if (!('options' in property)) return structure(property);

  return {
    ...property,
    options: [...property.options].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Returns a property's structure: for a formula only the type, since the person enters the
 * expression.
 */
function structure(property: PropertyShape): PropertyShape {
  return property.type === 'formula' ? { ...property, expression: '' } : property;
}

function describe(value: unknown): string {
  return JSON.stringify(value) ?? 'none';
}
