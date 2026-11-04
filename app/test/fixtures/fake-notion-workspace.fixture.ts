import {
  APIErrorCode,
  APIResponseError,
  Client,
  type CreateDatabaseParameters,
  type DatabaseObjectResponse,
  type DataSourceObjectResponse,
  type UpdateDataSourceParameters,
} from '@notionhq/client';
import {
  PLAIN_TYPES,
  workspaceOf,
  type DatabaseShape,
  type IconShape,
  type PropertyShape,
  type Workspace,
} from '../../src/notion/workspace/workspace-schema';
import type { LivePropertyConfig } from './notion-data-source.fixture';
import { titledDataSource } from './notion-workspace.fixture';

/**
 * How the live workspace names ids: a property by its name, an option by its name within the
 * property.
 */
interface Naming {
  readonly dataSourceOf: (title: string) => string;
  readonly propertyId: (database: string, property: string) => string;
  readonly optionId: (database: string, property: string, option: string) => string;
}

/** Builds a live workspace property from its shape: what `dataSources.retrieve` would return. */
function livePropertyOf(
  database: string,
  name: string,
  shape: PropertyShape,
  naming: Naming,
): LivePropertyConfig {
  const id = naming.propertyId(database, name);
  const description = shape.description;

  switch (shape.type) {
    case 'number':
      return { id, name, description, type: 'number', number: { format: shape.format } };
    case 'formula':
      return { id, name, description, type: 'formula', formula: { expression: shape.expression } };
    case 'unique_id':
      return { id, name, description, type: 'unique_id', unique_id: { prefix: shape.prefix } };
    case 'select':
    case 'multi_select':
    case 'status':
      return optionsPropertyOf(id, name, shape, (option) =>
        naming.optionId(database, name, option),
      );
    case 'rollup':
      return {
        id,
        name,
        description,
        type: 'rollup',
        rollup: {
          function: shape.function,
          relation_property_name: shape.relation,
          rollup_property_name: shape.rollup,
          relation_property_id: naming.propertyId(database, shape.relation),
          rollup_property_id: naming.propertyId(database, shape.rollup),
        },
      };
    case 'relation': {
      const target = naming.dataSourceOf(shape.target);
      const common = { database_id: `db-${target}`, data_source_id: target };

      return {
        id,
        name,
        description,
        type: 'relation',
        relation:
          shape.synced === null
            ? { ...common, type: 'single_property', single_property: {} }
            : {
                ...common,
                type: 'dual_property',
                dual_property: {
                  synced_property_id: naming.propertyId(shape.target, shape.synced),
                  synced_property_name: shape.synced,
                },
              },
      };
    }
    default:
      return plainPropertyOf(id, name, description, shape.type);
  }
}

function optionsPropertyOf(
  id: string,
  name: string,
  shape: Extract<PropertyShape, { type: 'select' | 'multi_select' | 'status' }>,
  optionId: (option: string) => string,
): LivePropertyConfig {
  const options = shape.options.map((option) => ({
    id: optionId(option.name),
    name: option.name,
    color: option.color,
    description: option.description,
  }));
  const { description } = shape;

  if (shape.type === 'select') {
    return { id, name, description, type: 'select', select: { options } };
  }

  if (shape.type === 'multi_select') {
    return { id, name, description, type: 'multi_select', multi_select: { options } };
  }

  return { id, name, description, type: 'status', status: { options, groups: [] } };
}

function plainPropertyOf(
  id: string,
  name: string,
  description: string | null,
  type: (typeof PLAIN_TYPES)[number],
): LivePropertyConfig {
  switch (type) {
    case 'title':
      return { id, name, description, type, title: {} };
    case 'rich_text':
      return { id, name, description, type, rich_text: {} };
    case 'date':
      return { id, name, description, type, date: {} };
    case 'checkbox':
      return { id, name, description, type, checkbox: {} };
    case 'url':
      return { id, name, description, type, url: {} };
    case 'email':
      return { id, name, description, type, email: {} };
    case 'phone_number':
      return { id, name, description, type, phone_number: {} };
    case 'files':
      return { id, name, description, type, files: {} };
    case 'people':
      return { id, name, description, type, people: {} };
    case 'created_by':
      return { id, name, description, type, created_by: {} };
    case 'created_time':
      return { id, name, description, type, created_time: {} };
    case 'last_edited_by':
      return { id, name, description, type, last_edited_by: {} };
    case 'last_edited_time':
      return { id, name, description, type, last_edited_time: {} };
  }
}

function iconResponseOf(icon: IconShape | null): DataSourceObjectResponse['icon'] {
  if (icon === null) return null;
  if (icon.type === 'emoji') return { type: 'emoji', emoji: icon.emoji };
  if (icon.type === 'icon') return { type: 'icon', icon: { name: icon.name, color: icon.color } };

  return { type: 'external', external: { url: icon.url } };
}

function textOf(content: string) {
  return content === ''
    ? []
    : [
        {
          type: 'text' as const,
          text: { content, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default' as const,
          },
          plain_text: content,
          href: null,
        },
      ];
}

/**
 * Builds a live workspace that has exactly these databases. The ids contain a name from which they
 * can be recognized, and the property ids are in REST form (the percent-encoded name, as in a real
 * workspace).
 */
export function liveWorkspaceOf(databases: readonly DatabaseShape[]): Workspace {
  const naming: Naming = {
    dataSourceOf: (title) => `ds_${title}`,
    propertyId: (database, property) => `p_${database}_${encodeURIComponent(property)}`,
    optionId: (database, property, option) =>
      `o_${database}_${encodeURIComponent(property)}_${encodeURIComponent(option)}`,
  };

  return workspaceOf(
    new Map(
      databases.map((database) => [
        naming.dataSourceOf(database.title),
        {
          ...titledDataSource(
            naming.dataSourceOf(database.title),
            database.title,
            [...database.properties].map(([name, shape]) =>
              livePropertyOf(database.title, name, shape, naming),
            ),
          ),
          description: textOf(database.description),
          icon: iconResponseOf(database.icon),
        },
      ]),
    ),
  );
}

type PropertyRequest = NonNullable<NonNullable<UpdateDataSourceParameters['properties']>[string]>;
type RichText = NonNullable<CreateDatabaseParameters['title']>;

function plainText(text: RichText | undefined): string {
  return (text ?? []).map((part) => (part.type === 'text' ? part.text.content : '')).join('');
}

/** Derives the shape from a REST request: what Notion would put into the property. */
function shapeOfRequest(
  request: Exclude<PropertyRequest, null>,
  titleOf: (dataSourceId: string) => string,
): PropertyShape | null {
  const description = 'description' in request ? (request.description ?? null) : null;

  if ('number' in request) {
    return { description, type: 'number', format: request.number.format ?? 'number' };
  }

  if ('formula' in request) {
    return { description, type: 'formula', expression: request.formula.expression ?? '' };
  }

  if ('select' in request || 'multi_select' in request || 'status' in request) {
    const type =
      'select' in request ? 'select' : 'multi_select' in request ? 'multi_select' : 'status';
    const given =
      'select' in request
        ? request.select.options
        : 'multi_select' in request
          ? request.multi_select.options
          : request.status.options;

    return {
      description,
      type,
      options: (given ?? []).map((option) => ({
        name: option.name ?? '',
        color: option.color ?? 'default',
        description: option.description ?? null,
      })),
    };
  }

  if ('relation' in request) {
    return {
      description,
      type: 'relation',
      target: titleOf(request.relation.data_source_id),
      synced:
        'dual_property' in request.relation
          ? (request.relation.dual_property.synced_property_name ?? null)
          : null,
    };
  }

  if ('rollup' in request) {
    return {
      description,
      type: 'rollup',
      relation:
        'relation_property_name' in request.rollup ? request.rollup.relation_property_name : '',
      rollup: 'rollup_property_name' in request.rollup ? request.rollup.rollup_property_name : '',
      function: request.rollup.function,
    };
  }

  if ('unique_id' in request) {
    return { description, type: 'unique_id', prefix: request.unique_id.prefix ?? null };
  }

  const plain = PLAIN_TYPES.find((type) => type in request);

  return plain === undefined ? null : { description, type: plain };
}

interface FakeDatabase {
  readonly id: string;
  readonly dataSourceId: string;
  title: string;
  description: string;
  icon: IconShape | null;
  trashed: boolean;
}

interface FakeSource {
  readonly id: string;
  readonly databaseId: string;
  /** Properties by name, in order of creation. */
  readonly properties: Map<string, PropertyShape>;
}

/**
 * An in-memory Notion with exactly the calls the workspace build uses: create a database, read and
 * change the schema of a data source, ask whose workspace it is. A two-way relation creates its
 * pair in the target database, and removing the relation removes the pair, as Notion does. A name
 * that is already taken is refused.
 */
export class FakeNotion {
  /** A personal token: creates databases and changes the schema. */
  readonly client = new Client({ auth: 'secret_test' });

  /** The integration: reads only what is open to it and does not change the schema. */
  readonly integration = new Client({ auth: 'secret_integration' });

  /** Every change in call order: what is created, changed or removed. */
  readonly writes: string[] = [];

  private readonly databases = new Map<string, FakeDatabase>();

  private created = 0;

  private breakpoint: number | null = null;

  private readonly sources = new Map<string, FakeSource>();

  private readonly hidden = new Set<string>();

  constructor(
    readonly workspace = 'workspace-1',
    readonly personalWorkspace = workspace,
  ) {
    jest
      .spyOn(this.integration.users, 'me')
      .mockImplementation(() => Promise.resolve(this.bot(workspace)));
    jest
      .spyOn(this.integration.dataSources, 'retrieve')
      .mockImplementation(({ data_source_id }) => {
        if (this.hidden.has(this.titleOf(data_source_id))) {
          return Promise.reject(notFound(data_source_id));
        }

        return Promise.resolve(this.dataSourceResponse(data_source_id));
      });
    const readOnly = (): Promise<never> =>
      Promise.reject(new Error('the integration does not change the schema'));

    jest.spyOn(this.integration.databases, 'create').mockImplementation(readOnly);
    jest.spyOn(this.integration.databases, 'update').mockImplementation(readOnly);
    jest.spyOn(this.integration.dataSources, 'update').mockImplementation(readOnly);
    jest
      .spyOn(this.client.users, 'me')
      .mockImplementation(() => Promise.resolve(this.bot(personalWorkspace)));
    jest
      .spyOn(this.client.databases, 'create')
      .mockImplementation((request) => Promise.resolve(this.create(request)));
    jest
      .spyOn(this.client.databases, 'retrieve')
      .mockImplementation(({ database_id }) => Promise.resolve(this.databaseResponse(database_id)));
    jest.spyOn(this.client.databases, 'update').mockImplementation((request) => {
      const database = this.database(request.database_id);

      this.writes.push(`restyle ${database.title}`);
      database.title = request.title ? plainText(request.title) : database.title;
      database.description = request.description
        ? plainText(request.description)
        : database.description;

      return Promise.resolve(this.databaseResponse(database.id));
    });
    jest
      .spyOn(this.client.dataSources, 'retrieve')
      .mockImplementation(({ data_source_id }) =>
        Promise.resolve(this.dataSourceResponse(data_source_id)),
      );
    jest.spyOn(this.client.dataSources, 'update').mockImplementation((request) => {
      this.update(request);

      return Promise.resolve(this.dataSourceResponse(request.data_source_id));
    });
  }

  /** Hides a database from the integration. In Notion the person grants access. */
  hide(title: string): void {
    this.hidden.add(title);
  }

  /** Opens a database to the integration. */
  show(title: string): void {
    this.hidden.delete(title);
  }

  /** Builds the `users.me` answer for the bot of this workspace. */
  private bot(workspace: string): Awaited<ReturnType<Client['users']['me']>> {
    return {
      object: 'user',
      id: 'bot-1',
      name: 'integration',
      avatar_url: null,
      type: 'bot',
      bot: {
        owner: { type: 'workspace', workspace: true },
        workspace_id: workspace,
        workspace_name: null,
        workspace_limits: { max_file_upload_size_in_bytes: 1 },
      },
    };
  }

  /** Returns the databases currently in the workspace, as shapes. */
  shapes(): DatabaseShape[] {
    return [...this.live().values()].map(({ shape }) => shape);
  }

  /** Returns the live workspace the way the code reads it. */
  live(): Workspace {
    return workspaceOf(
      new Map(
        [...this.sources.keys()]
          .filter((id) => !this.database(this.source(id).databaseId).trashed)
          .map((id) => [id, this.dataSourceResponse(id)]),
      ),
    );
  }

  /** Returns the data source id of a database, by name. */
  dataSourceOf(title: string): string {
    const database = [...this.databases.values()].find(
      (candidate) => candidate.title === title && !candidate.trashed,
    );

    if (database === undefined) throw new Error(`the fake workspace has no ${title}`);

    return database.dataSourceId;
  }

  /** Moves a database to the trash. After that Notion returns it with `in_trash`. */
  trash(title: string): void {
    this.database(this.dataSourceOf(title)).trashed = true;
  }

  /** Sets or removes a property directly, outside the build, the way a person does by hand. */
  setProperty(title: string, name: string, shape: PropertyShape | null): void {
    const properties = this.source(this.dataSourceOf(title)).properties;

    if (shape === null) properties.delete(name);
    else properties.set(name, shape);
  }

  /**
   * Enters an expression into a formula as the person does. This is how the expression appears in
   * Notion.
   */
  enterFormula(title: string, name: string, expression: string): void {
    this.setProperty(title, name, { description: null, type: 'formula', expression });
  }

  /**
   * Adds a database the build did not create. It sits in the workspace alongside, with no ledger
   * row.
   */
  addDatabase(title: string): void {
    this.create(
      {
        parent: { type: 'workspace', workspace: true },
        title: [{ type: 'text', text: { content: title } }],
      },
      false,
    );
  }

  /** Makes the next creation fail after `creations` created databases: an interrupted launch. */
  breakAfter(creations: number | null): void {
    this.breakpoint = creations === null ? null : this.created + creations;
  }

  private database(id: string): FakeDatabase {
    const database =
      this.databases.get(id) ??
      [...this.databases.values()].find((candidate) => candidate.dataSourceId === id);

    if (database === undefined) throw new Error(`object_not_found: database ${id}`);

    return database;
  }

  private source(id: string): FakeSource {
    const source = this.sources.get(id);

    if (source === undefined) throw new Error(`object_not_found: data source ${id}`);

    return source;
  }

  private titleOf(dataSourceId: string): string {
    return this.database(this.source(dataSourceId).databaseId).title;
  }

  private create(request: CreateDatabaseParameters, logged = true) {
    if (logged && this.breakpoint !== null && this.created >= this.breakpoint) {
      throw new Error('network is down');
    }

    const number = this.databases.size + 1;
    const database: FakeDatabase = {
      id: `db-${number}`,
      dataSourceId: `ds-${number}`,
      title: plainText(request.title),
      description: plainText(request.description),
      icon: iconOf(request.icon),
      trashed: false,
    };
    const titleName = Object.keys(request.initial_data_source?.properties ?? {})[0] ?? 'Name';

    if (logged) {
      this.created += 1;
      this.writes.push(`create ${database.title} at the top level`);
    }

    this.databases.set(database.id, database);
    this.sources.set(database.dataSourceId, {
      id: database.dataSourceId,
      databaseId: database.id,
      properties: new Map([[titleName, { description: null, type: 'title' }]]),
    });

    return { object: 'database' as const, id: database.id };
  }

  private update(request: UpdateDataSourceParameters): void {
    const source = this.source(request.data_source_id);

    this.writes.push(`update ${this.titleOf(source.id)}`);

    if (request.title) this.database(source.databaseId).title = plainText(request.title);

    for (const [name, change] of Object.entries(request.properties ?? {})) {
      if (change === null) this.remove(source, name);
      else if (Object.keys(change).length === 1 && 'name' in change) {
        this.rename(source, name, change.name ?? name);
      } else this.set(source, name, change);
    }
  }

  private rename(source: FakeSource, from: string, to: string): void {
    const shape = source.properties.get(from);

    if (shape === undefined) throw new Error(`validation_error: no property ${from}`);

    source.properties.delete(from);
    source.properties.set(to, shape);
  }

  private remove(source: FakeSource, name: string): void {
    const shape = source.properties.get(name);

    source.properties.delete(name);

    if (shape?.type === 'relation' && shape.synced !== null) {
      this.sources.get(this.dataSourceOf(shape.target))?.properties.delete(shape.synced);
    }
  }

  private set(source: FakeSource, name: string, request: Exclude<PropertyRequest, null>): void {
    const shape = shapeOfRequest(request, (id) => this.titleOf(id));

    if (shape === null) throw new Error(`validation_error: ${name} has no type`);

    if (source.properties.has(name)) this.remove(source, name);

    source.properties.set(name, shape);

    if (shape.type !== 'relation' || shape.synced === null) return;

    const partner = this.source(this.dataSourceOf(shape.target));

    if (partner.properties.has(shape.synced)) {
      throw new Error(`validation_error: ${shape.target} already has ${shape.synced}`);
    }

    partner.properties.set(shape.synced, {
      description: null,
      type: 'relation',
      target: this.titleOf(source.id),
      synced: name,
    });
  }

  private databaseResponse(id: string): DatabaseObjectResponse {
    const database = this.database(id);

    return {
      object: 'database',
      id: database.id,
      title: textOf(database.title),
      description: textOf(database.description),
      parent: { type: 'workspace', workspace: true },
      is_inline: false,
      in_trash: database.trashed,
      archived: database.trashed,
      is_locked: false,
      created_time: '2026-09-01T00:00:00.000Z',
      last_edited_time: '2026-09-01T00:00:00.000Z',
      data_sources: [{ id: database.dataSourceId, name: database.title }],
      icon: iconResponseOf(database.icon),
      cover: null,
      url: `https://www.notion.so/${database.id}`,
      public_url: null,
    };
  }

  private dataSourceResponse(id: string): DataSourceObjectResponse {
    const source = this.source(id);
    const database = this.database(source.databaseId);
    const naming: Naming = {
      dataSourceOf: (title) => this.dataSourceOf(title),
      propertyId: (title, property) => `${title}:${encodeURIComponent(property)}`,
      optionId: (title, property, option) =>
        `${title}:${encodeURIComponent(property)}:${encodeURIComponent(option)}`,
    };

    return {
      ...titledDataSource(
        id,
        database.title,
        [...source.properties].map(([name, shape]) =>
          livePropertyOf(database.title, name, shape, naming),
        ),
      ),
      parent: { type: 'database_id', database_id: database.id },
      description: textOf(database.description),
      icon: iconResponseOf(database.icon),
      in_trash: database.trashed,
      archived: database.trashed,
    };
  }
}

/** Builds Notion's refusal for a database the client cannot see. */
function notFound(id: string): APIResponseError {
  return new APIResponseError({
    code: APIErrorCode.ObjectNotFound,
    status: 404,
    message: `Could not find data source with ID: ${id}`,
    headers: {},
    rawBodyText: '',
    additional_data: undefined,
    request_id: undefined,
  });
}

function iconOf(icon: CreateDatabaseParameters['icon']): IconShape | null {
  if (icon === undefined) return null;
  if (icon.type === 'emoji') return { type: 'emoji', emoji: icon.emoji };
  if (icon.type === 'icon') {
    return { type: 'icon', name: icon.icon.name, color: icon.icon.color ?? 'gray' };
  }
  if (icon.type === 'external') return { type: 'external', url: icon.external.url };

  return null;
}
