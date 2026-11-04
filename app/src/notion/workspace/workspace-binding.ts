import { readFileSync } from 'node:fs';
import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { bindingFileSchema, type Representation } from '../binding/binding.schema';
import { propertyIdFromBinding } from '../client/property-id';
import type { NamedBinding, NamedRepresentation } from './workspace-contract';
import type { LiveDatabase, Workspace } from './workspace-schema';

interface BindingRequest {
  /** The binding with names: what is related to what, without ids. */
  readonly named: NamedBinding;
  /** The live workspace each id is taken from. */
  readonly live: Workspace;
  /** Identifies the workspace the file belongs to. */
  readonly workspace: string;
  /** The command that writes the file: it appears in the file's header. */
  readonly command: string;
  /**
   * Slots this binding handles differently from how the contract names them: the key is
   * `type.field`, the value is the representation, already in live-workspace ids.
   */
  readonly overrides?: Readonly<Record<string, Representation>>;
}

interface GeneratedBinding {
  /** The text of the binding file, suitable for `loadBinding`. */
  readonly text: string;
  /** Signals that are not bound because their formula in the live workspace is empty. */
  readonly unbound: readonly string[];
}

/**
 * Generates the binding from names to ids. Every name becomes an id through the live workspace: a
 * database by title, a property by its name in the database, an option by its name in the
 * property. The slots and decisions are the same as in the contract; `overrides` is the only
 * exception.
 *
 * A signal is bound when its formula in the live workspace has an expression, because an empty
 * column reads as a value that is not there. An unreadable signal is worse than a missing one.
 */
export function generateBinding({
  named,
  live,
  workspace,
  command,
  overrides = {},
}: BindingRequest): GeneratedBinding {
  const ids = new LiveIds(live);
  const signals = Object.entries(named.signals).map(([slot, property]) => ({
    slot,
    property,
    database: databaseOfType(named, slot.split('.')[0] ?? ''),
  }));
  const entered = signals.filter(({ database, property }) => ids.hasExpression(database, property));
  const file = bindingFileSchema.parse({
    workspace,
    data_sources: Object.fromEntries(
      Object.entries(named.data_sources).map(([type, title]) => [type, ids.dataSource(title)]),
    ),
    fields: fieldsOf(named, ids, overrides),
    options: optionsOf(named, ids),
    signals: Object.fromEntries(
      entered.map(({ slot, property, database }) => [slot, ids.property(database, property)]),
    ),
  });

  return {
    text: header(command) + stringify(file),
    unbound: signals.filter((signal) => !entered.includes(signal)).map(({ slot }) => slot),
  };
}

function databaseOfType(named: NamedBinding, type: string): string {
  const title = Object.entries(named.data_sources).find(([key]) => key === type)?.[1];

  if (title === undefined) throw new Error(`the binding names no database for ${type}`);

  return title;
}

function fieldsOf(
  named: NamedBinding,
  ids: LiveIds,
  overrides: Readonly<Record<string, Representation>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(named.fields).map(([type, slots]) => [
      type,
      Object.fromEntries(
        Object.entries(slots).map(([field, representation]) => [
          field,
          overrides[`${type}.${field}`] ?? idsOf(representation, databaseOfType(named, type), ids),
        ]),
      ),
    ]),
  );
}

/**
 * Builds the set of option ids for each slot. The live workspace resolves an option's name in the
 * field's property.
 */
function optionsOf(named: NamedBinding, ids: LiveIds): Record<string, Record<string, unknown>> {
  const fields = new Map(Object.entries(named.fields));

  return Object.fromEntries(
    Object.entries(named.options).map(([slot, sets]) => {
      const [type = '', field = ''] = slot.split('.');
      const representation = fields.get(type)?.[field];

      if (representation?.kind !== 'native') {
        throw new Error(`the binding has options for ${slot}, which is not a native field`);
      }

      const database = databaseOfType(named, type);
      const idsOfSet = (set: Readonly<Record<string, string>>): Record<string, string> =>
        Object.fromEntries(
          Object.entries(set).map(([canonical, option]) => [
            canonical,
            ids.option(database, representation.property, option),
          ]),
        );

      return [
        slot,
        {
          canonical: idsOfSet(sets.canonical),
          ...(sets.known_non_canonical
            ? { known_non_canonical: idsOfSet(sets.known_non_canonical) }
            : {}),
        },
      ];
    }),
  );
}

/**
 * Returns whose binding it is: the `workspace` key of its file. `undefined` means the file names
 * none.
 */
export function bindingWorkspaceOf(file: string): string | undefined {
  const parsed = z
    .object({ workspace: z.string() })
    .safeParse(parseDocument(readFileSync(file, 'utf8')).toJS());

  return parsed.success ? parsed.data.workspace : undefined;
}

function header(command: string): string {
  return [
    '# Binding of the canonical model to a Notion workspace.',
    `# Generated by \`${command}\` from contracts/notion-workspace.yaml; edits here are overwritten.`,
    '',
  ].join('\n');
}

function idsOf(representation: NamedRepresentation, database: string, ids: LiveIds): unknown {
  switch (representation.kind) {
    case 'native':
      return { kind: 'native', propertyId: ids.property(database, representation.property) };

    case 'relation':
      return {
        kind: 'relation',
        propertyId: ids.property(database, representation.property),
        dataSourceId: ids.dataSource(representation.database),
        twoWay: representation.twoWay,
        ...(representation.syncedProperty === undefined
          ? {}
          : {
              syncedPropertyId: ids.property(
                representation.database,
                representation.syncedProperty,
              ),
            }),
      };

    case 'traversed':
      return {
        kind: 'traversed',
        via: ids.property(database, representation.via),
        rule: representation.rule,
      };

    default:
      return representation;
  }
}

/** Live-workspace ids by name. */
class LiveIds {
  private readonly byTitle: ReadonlyMap<string, LiveDatabase>;

  constructor(live: Workspace) {
    this.byTitle = new Map([...live.values()].map((database) => [database.shape.title, database]));
  }

  dataSource(title: string): string {
    return this.database(title).dataSourceId;
  }

  /** Returns the id as REST returns it, because the binding file records the id in this form. */
  property(title: string, name: string): string {
    const id = this.database(title).propertyIds.get(name);

    if (id === undefined) throw new Error(`${title}."${name}" is missing in the workspace`);
    if (propertyIdFromBinding(id) === null) {
      throw new Error(`${title}."${name}" has id ${id}, which is not valid percent-encoding`);
    }

    return id;
  }

  option(title: string, property: string, name: string): string {
    const id = this.database(title).optionIds.get(property)?.get(name);

    if (id === undefined) {
      throw new Error(`${title}."${property}" has no option ${name} in the workspace`);
    }

    return id;
  }

  /** Checks whether the formula has an expression. An empty column does not go into the binding. */
  hasExpression(title: string, name: string): boolean {
    const property = this.database(title).shape.properties.get(name);

    if (property === undefined) throw new Error(`${title}."${name}" is missing in the workspace`);

    return property.type === 'formula' && property.expression.trim() !== '';
  }

  private database(title: string): LiveDatabase {
    const database = this.byTitle.get(title);

    if (database === undefined) throw new Error(`database ${title} is missing in the workspace`);

    return database;
  }
}
