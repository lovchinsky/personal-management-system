import {
  APIErrorCode,
  isFullDatabase,
  isNotionClientError,
  type Client,
  type CreateDatabaseParameters,
  type DataSourceObjectResponse,
  type UpdateDataSourceParameters,
} from '@notionhq/client';
import {
  dataSourceReader,
  lookOf,
  readDataSources,
  sameProperty,
  workspaceOf,
  type DatabaseShape,
  type IconShape,
  type PlainType,
  type PropertyShape,
} from './workspace-schema';

type PropertyUpdate = NonNullable<NonNullable<UpdateDataSourceParameters['properties']>[string]>;
type IconRequest = NonNullable<CreateDatabaseParameters['icon']>;

/** The requests for one database's properties: name → settings, or `null` to remove. */
type Requests = Record<string, PropertyUpdate | null>;

/**
 * Stages in dependency order: extras are removed first, to free the names; a relation needs both
 * databases; a rollup needs the relation and the property it collects, which may be a formula.
 */
type Stage = 'remove' | 'scalar' | 'relation' | 'formula' | 'rollup';

const STAGES: readonly Stage[] = ['remove', 'scalar', 'relation', 'formula', 'rollup'];

/**
 * What the sync has already built: database title → its data source. This is the sync's ledger
 * (`workspace-ledger.ts`).
 */
export type Built = ReadonlyMap<string, string>;

interface SyncOptions {
  /** The personal token: only it creates databases at the top level of the workspace. */
  readonly notion: Client;
  /** The schema the sync brings the workspace to: databases by title, without ids. */
  readonly target: readonly DatabaseShape[];
  readonly built: Built;
  /**
   * Saves the ledger right after a database is created, so an interrupted sync does not create the
   * database twice.
   */
  readonly record: (built: Built) => void;
  readonly log: (line: string) => void;
}

/**
 * Brings the ledger's databases to the target schema: a missing database is created at the top
 * level, a missing or differing property is set, an extra one is removed. Running it again
 * applies only the differences. It does not touch records.
 *
 * The sync removes an extra property, and removing a two-way relation also destroys its pair in
 * the partner database. So the sync touches only the databases of its own ledger: it reads only
 * them, writes only to them, and a relation from a ledger database to one outside the ledger is
 * refused before the first property change. A foreign database can be neither changed nor removed.
 *
 * The sync only creates a formula, with an empty expression, and never writes the expression. The
 * person enters the expression in the Notion interface, because REST does not accept formulas
 * that read a related database.
 */
export async function syncWorkspace({
  notion,
  target,
  built,
  record,
  log,
}: SyncOptions): Promise<Built> {
  const state = new Map(built);
  const unknown = [...state.keys()].filter((title) => !target.some((it) => it.title === title));

  // The ledger keeps database titles: an entry the target does not know means a ledger of another
  // shape, which would make the sync create all the databases a second time.
  if (unknown.length > 0) {
    throw new Error(
      `the ledger names ${unknown.join(', ')}, which the target does not have: it keeps database titles`,
    );
  }

  for (const database of target) {
    const existing = await existingDataSource(notion, state.get(database.title));

    if (existing === null) {
      log(`creating database ${database.title}`);
      state.set(database.title, await createDatabase(notion, database));
      record(state);
    } else if (!sameLook(existing, database)) {
      log(`restyling database ${database.title}`);
      await restyle(notion, existing, database);
    }
  }

  const idOf = (title: string): string => {
    const id = state.get(title);

    if (id === undefined) throw new Error(`database ${title} is not built`);

    return id;
  };
  const read = dataSourceReader(notion, 'the syncing client');
  const refresh = async (): Promise<ReadonlyMap<string, DatabaseShape>> => {
    const live = workspaceOf(await readDataSources(read, [...state.values()], 'listed'));

    return new Map([...live.values()].map(({ shape }) => [shape.title, shape]));
  };
  let shapes = await refresh();

  for (const stage of STAGES) {
    for (const shape of target) {
      const live = shapes.get(shape.title);

      if (live === undefined) throw new Error(`database ${shape.title} was not read back`);

      const requests = requestsOf(stage, shape, live, idOf);

      if (Object.keys(requests).length === 0) continue;

      log(`${shape.title}: ${stage} — ${Object.keys(requests).join(', ')}`);
      await notion.dataSources.update({
        data_source_id: idOf(shape.title),
        properties: requests,
      });
      // Removing or creating a two-way relation changes the partner database too.
      shapes = await refresh();
    }
  }

  return state;
}

/**
 * Returns a database's requests for a stage: what to set so the live database matches the target.
 */
export function requestsOf(
  stage: Stage,
  target: DatabaseShape,
  live: DatabaseShape,
  idOf: (title: string) => string,
): Requests {
  const requests: Requests = {};

  if (stage === 'remove') {
    for (const [name, property] of live.properties) {
      if (!target.properties.has(name) && property.type !== 'title') requests[name] = null;
    }

    return requests;
  }

  if (stage === 'scalar') {
    const wanted = titleNameOf(target);
    const current = titleNameOf(live);

    if (wanted !== current) requests[current] = { name: wanted };
  }

  for (const [name, property] of target.properties) {
    const present = live.properties.get(name);

    if (stageOf(property) !== stage || property.type === 'title') continue;
    if (present !== undefined && sameProperty(property, present)) continue;
    // A database's two-way relation to itself creates both properties in one request.
    if (
      property.type === 'relation' &&
      property.target === target.title &&
      property.synced !== null &&
      property.synced in requests
    ) {
      continue;
    }

    requests[name] = requestOf(property, idOf);
  }

  return requests;
}

function stageOf(property: PropertyShape): Stage {
  if (property.type === 'relation' || property.type === 'formula' || property.type === 'rollup') {
    return property.type;
  }

  return 'scalar';
}

function titleNameOf(shape: DatabaseShape): string {
  const name = [...shape.properties].find(([, property]) => property.type === 'title')?.[0];

  if (name === undefined) throw new Error(`database ${shape.title} has no title property`);

  return name;
}

/** Returns a property's settings: what REST accepts to create or change it. */
function requestOf(property: PropertyShape, idOf: (title: string) => string): PropertyUpdate {
  const { description } = property;

  switch (property.type) {
    case 'number':
      return { description, number: { format: property.format } };
    case 'select':
      return { description, select: { options: [...property.options] } };
    case 'multi_select':
      return { description, multi_select: { options: [...property.options] } };
    case 'status':
      return { description, status: { options: [...property.options] } };
    case 'unique_id':
      return { description, unique_id: { prefix: property.prefix } };
    case 'formula':
      return { description, formula: { expression: '' } };
    case 'rollup':
      return {
        description,
        rollup: {
          function: property.function,
          relation_property_name: property.relation,
          rollup_property_name: property.rollup,
        },
      };
    case 'relation': {
      const data_source_id = idOf(property.target);

      return property.synced === null
        ? {
            description,
            relation: { data_source_id, type: 'single_property', single_property: {} },
          }
        : {
            description,
            relation: {
              data_source_id,
              type: 'dual_property',
              dual_property: { synced_property_name: property.synced },
            },
          };
    }
    default:
      return plainRequest(property.type, description);
  }
}

/**
 * Returns the request for a property without settings: each type names itself and an empty object.
 */
function plainRequest(type: PlainType, description: string | null): PropertyUpdate {
  switch (type) {
    case 'title':
      return { description, title: {} };
    case 'rich_text':
      return { description, rich_text: {} };
    case 'date':
      return { description, date: {} };
    case 'checkbox':
      return { description, checkbox: {} };
    case 'url':
      return { description, url: {} };
    case 'email':
      return { description, email: {} };
    case 'phone_number':
      return { description, phone_number: {} };
    case 'files':
      return { description, files: {} };
    case 'people':
      return { description, people: {} };
    case 'created_by':
      return { description, created_by: {} };
    case 'created_time':
      return { description, created_time: {} };
    case 'last_edited_by':
      return { description, last_edited_by: {} };
    case 'last_edited_time':
      return { description, last_edited_time: {} };
  }
}

/** Returns the data source the sync built earlier, if it has not been deleted. */
async function existingDataSource(
  notion: Client,
  dataSourceId: string | undefined,
): Promise<DataSourceObjectResponse | null> {
  if (dataSourceId === undefined) return null;

  try {
    const response = await dataSourceReader(notion, 'the syncing client')(dataSourceId);

    return response.in_trash ? null : response;
  } catch (error) {
    if (isNotionClientError(error) && error.code === APIErrorCode.ObjectNotFound) return null;

    throw error;
  }
}

async function createDatabase(notion: Client, shape: DatabaseShape): Promise<string> {
  const created = await notion.databases.create({
    parent: { type: 'workspace', workspace: true },
    title: richText(shape.title),
    description: richText(shape.description),
    icon: iconRequest(shape.icon),
    is_inline: false,
    initial_data_source: { properties: { [titleNameOf(shape)]: { title: {} } } },
  });
  const database = isFullDatabase(created)
    ? created
    : await notion.databases.retrieve({ database_id: created.id });
  const dataSource = isFullDatabase(database) ? database.data_sources[0] : undefined;

  if (dataSource === undefined) {
    throw new Error(`database ${shape.title} was created without a data source`);
  }

  return dataSource.id;
}

function sameLook(existing: DataSourceObjectResponse, shape: DatabaseShape): boolean {
  const look = lookOf(existing);

  return (
    look.title === shape.title &&
    look.description === shape.description &&
    JSON.stringify(look.icon) === JSON.stringify(shape.icon)
  );
}

async function restyle(
  notion: Client,
  existing: DataSourceObjectResponse,
  shape: DatabaseShape,
): Promise<void> {
  if (existing.parent.type !== 'database_id') {
    throw new Error(`data source ${existing.id} does not belong to a database`);
  }

  await notion.databases.update({
    database_id: existing.parent.database_id,
    title: richText(shape.title),
    description: richText(shape.description),
    icon: iconRequest(shape.icon),
  });
  await notion.dataSources.update({ data_source_id: existing.id, title: richText(shape.title) });
}

function richText(content: string): { type: 'text'; text: { content: string } }[] {
  return content === '' ? [] : [{ type: 'text', text: { content } }];
}

function iconRequest(icon: IconShape | null): IconRequest | undefined {
  if (icon === null) return undefined;
  if (icon.type === 'emoji') return { type: 'emoji', emoji: icon.emoji };
  if (icon.type === 'icon') return { type: 'icon', icon: { name: icon.name, color: icon.color } };

  return { type: 'external', external: { url: icon.url } };
}
